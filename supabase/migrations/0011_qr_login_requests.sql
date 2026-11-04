-- Panel QR-code login (like WhatsApp Web). The browser asks for a request, shows a QR with a Telegram deep
-- link, and the person confirms on the phone; the browser then gets a one-use session token.
--
-- Secrets are stored only as SHA-256 hashes (hex, 64 chars): `nonce_hash` identifies the request when the
-- bot receives `/start login_<nonce>`, and `poll_hash` is checked when the browser asks for the result, so
-- only the browser that created the request can receive the token. The public `id` reveals neither.
--
-- Closed table like the other Telegram tables: RLS on, no client grants (service_role only, via the API).
-- State machine, every step an atomic UPDATE so two taps or two browsers cannot both win:
--   aguardando -> confirmar (bot asked) -> aprovado | negado -> consumido
--   aguardando -> recusado (the Telegram has no account)
-- Everything has to happen before `expires_at` (a few minutes). The scheduler purges old rows.

create table public.qr_login_requests (
  id uuid primary key default gen_random_uuid(),
  nonce_hash text not null unique,
  poll_hash text not null,
  status text not null default 'aguardando',
  user_id uuid references public.profiles(id) on delete cascade,
  chat_id bigint,
  client_label text not null default 'Navegador',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz,
  consumed_at timestamptz,
  constraint qr_login_status_check check (status in ('aguardando', 'confirmar', 'aprovado', 'negado', 'recusado', 'consumido')),
  constraint qr_login_nonce_check check (nonce_hash ~ '^[0-9a-f]{64}$'),
  constraint qr_login_poll_check check (poll_hash ~ '^[0-9a-f]{64}$'),
  constraint qr_login_label_check check (char_length(client_label) between 1 and 60),
  constraint qr_login_expiry_check check (expires_at > created_at)
);

create index qr_login_requests_expires_idx on public.qr_login_requests (expires_at);

alter table public.qr_login_requests enable row level security;
revoke all on table public.qr_login_requests from public, anon, authenticated;

-- The bot received `/start login_<nonce>` from `p_chat_id`. With an account (`p_user_id`) the request moves to
-- 'confirmar' and the bot asks; without one it becomes 'recusado'. Returns nothing unless the request exists,
-- is still 'aguardando' and not expired (a second tap, an old QR, a made-up nonce: all look the same).
create function public.open_qr_login(p_nonce_hash text, p_chat_id bigint, p_user_id uuid, p_now timestamptz)
returns table (id uuid, outcome text, client_label text, created_at timestamptz)
language sql
as $$
  update public.qr_login_requests r
     set status = case when p_user_id is null then 'recusado' else 'confirmar' end,
         chat_id = p_chat_id,
         user_id = p_user_id
   where r.nonce_hash = p_nonce_hash
     and r.status = 'aguardando'
     and r.expires_at > p_now
  returning r.id, r.status, r.client_label, r.created_at;
$$;

-- The person answered the bot. Only the chat that opened the request, for the account that was asked, while the
-- request is still 'confirmar' and not expired. Returns the new status ('aprovado' or 'negado'), or nothing.
create function public.decide_qr_login(p_id uuid, p_chat_id bigint, p_user_id uuid, p_approve boolean, p_now timestamptz)
returns text
language plpgsql
as $$
declare
  v_status text;
begin
  update public.qr_login_requests r
     set status = case when p_approve then 'aprovado' else 'negado' end,
         decided_at = p_now
   where r.id = p_id
     and r.status = 'confirmar'
     and r.chat_id = p_chat_id
     and r.user_id = p_user_id
     and r.expires_at > p_now
  returning r.status into v_status;
  return v_status;
end;
$$;

-- The browser that holds the poll secret collects the approval. Atomic: only one call gets the user id;
-- afterwards the request is 'consumido'. Returns nothing unless 'aprovado', not expired, and the secret matches.
create function public.consume_qr_login(p_id uuid, p_poll_hash text, p_now timestamptz)
returns uuid
language plpgsql
as $$
declare
  v_user uuid;
begin
  update public.qr_login_requests r
     set status = 'consumido', consumed_at = p_now
   where r.id = p_id
     and r.poll_hash = p_poll_hash
     and r.status = 'aprovado'
     and r.expires_at > p_now
  returning r.user_id into v_user;
  return v_user;
end;
$$;

-- Gives a consumed request back (issuing the session failed), so the next poll can try again.
create function public.release_qr_login(p_id uuid)
returns void
language sql
as $$
  update public.qr_login_requests set status = 'aprovado', consumed_at = null
   where id = p_id and status = 'consumido';
$$;

-- Deletes rows that expired more than ten minutes ago; returns how many. (Younger ones stay so a late poll
-- still reads "expirado" instead of "not found".)
create function public.purge_qr_login_requests(p_now timestamptz)
returns integer
language sql
as $$
  with gone as (
    delete from public.qr_login_requests where expires_at < p_now - interval '10 minutes' returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.open_qr_login(text, bigint, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.decide_qr_login(uuid, bigint, uuid, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_qr_login(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.release_qr_login(uuid) from public, anon, authenticated;
revoke all on function public.purge_qr_login_requests(timestamptz) from public, anon, authenticated;
grant execute on function public.open_qr_login(text, bigint, uuid, timestamptz) to service_role;
grant execute on function public.decide_qr_login(uuid, bigint, uuid, boolean, timestamptz) to service_role;
grant execute on function public.consume_qr_login(uuid, text, timestamptz) to service_role;
grant execute on function public.release_qr_login(uuid) to service_role;
grant execute on function public.purge_qr_login_requests(timestamptz) to service_role;
