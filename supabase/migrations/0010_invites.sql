-- Invites: how a new person gets an account. An administrator creates a one-use code; the guest sends
-- `/start CODE` to the bot; the API claims the code atomically, creates the account tied to that Telegram
-- user and links the chat. The sign-up page is closed to the public.
--
-- Closed table like the other Telegram tables: RLS on, no client grants (service_role only, via the API).
-- The code is the primary key (12 chars from an alphabet without look-alikes; ~59 bits).

create table public.invites (
  code text primary key,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  claimed_at timestamptz,
  used_by uuid references public.profiles(id) on delete set null,
  used_at timestamptz,
  constraint invites_code_check check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$'),
  constraint invites_expiry_check check (expires_at > created_at)
);

create index invites_created_idx on public.invites (created_at desc);

alter table public.invites enable row level security;
revoke all on table public.invites from public, anon, authenticated;

-- Claims a code for exactly one caller. True only when the code exists, is not revoked, not expired and not
-- yet claimed: the UPDATE is the lock, so two simultaneous callers cannot both win.
create function public.claim_invite(p_code text, p_now timestamptz)
returns boolean
language plpgsql
as $$
declare
  v_code text;
begin
  update public.invites
     set claimed_at = p_now
   where code = p_code
     and claimed_at is null
     and revoked_at is null
     and expires_at > p_now
  returning code into v_code;
  return v_code is not null;
end;
$$;

-- Marks a claimed code as used by the account that was created. No-op unless it was claimed and unused.
create function public.finish_invite(p_code text, p_user_id uuid, p_now timestamptz)
returns boolean
language plpgsql
as $$
declare
  v_code text;
begin
  update public.invites
     set used_by = p_user_id, used_at = p_now
   where code = p_code and claimed_at is not null and used_at is null
  returning code into v_code;
  return v_code is not null;
end;
$$;

-- Gives a claimed-but-unused code back (account creation failed), so the guest can try again.
create function public.release_invite(p_code text)
returns void
language sql
as $$
  update public.invites set claimed_at = null where code = p_code and used_at is null;
$$;

revoke all on function public.claim_invite(text, timestamptz) from public, anon, authenticated;
revoke all on function public.finish_invite(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.release_invite(text) from public, anon, authenticated;
grant execute on function public.claim_invite(text, timestamptz) to service_role;
grant execute on function public.finish_invite(text, uuid, timestamptz) to service_role;
grant execute on function public.release_invite(text) to service_role;
