-- Chat captures: proposals the Telegram bot makes from a message ("gastei 100 em roupa") while the person
-- confirms, edits or undoes them with inline buttons. Nothing is written to tasks or finance_entries
-- before "Confirmar"; the proposal lives here only.
--
-- Closed table like the other Telegram tables: RLS on, no client grants (service_role only, via the API).
-- `status` is a small state machine so a double tap cannot create two entries:
--   pendente -> confirmando (atomic claim) -> confirmada -> desfeita; a failed creation goes back to pendente.
-- `expires_at`: one hour for a pending proposal; confirming moves it to 24 h so "Desfazer" keeps working.
-- The scheduler purges expired rows (purge_expired_chat_captures).

create table public.chat_captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  chat_id bigint not null,
  payload jsonb not null,
  status text not null default 'pendente',
  entity_kind text,
  entity_id uuid,
  message_id bigint,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint chat_captures_status_check check (status in ('pendente', 'confirmando', 'confirmada', 'desfeita')),
  constraint chat_captures_entity_kind_check check (entity_kind is null or entity_kind in ('tarefa', 'lancamento')),
  constraint chat_captures_entity_pair_check check ((entity_kind is null) = (entity_id is null)),
  constraint chat_captures_payload_size_check check (pg_column_size(payload) < 4096)
);

create index chat_captures_user_created_idx on public.chat_captures (user_id, created_at desc);
create index chat_captures_expires_idx on public.chat_captures (expires_at);

alter table public.chat_captures enable row level security;
revoke all on table public.chat_captures from public, anon, authenticated;

-- Deletes expired proposals; returns how many. SECURITY INVOKER: only service_role (the scheduler) may call it.
create function public.purge_expired_chat_captures(p_now timestamptz)
returns integer
language sql
as $$
  with gone as (
    delete from public.chat_captures where expires_at < p_now returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.purge_expired_chat_captures(timestamptz) from public, anon, authenticated;
grant execute on function public.purge_expired_chat_captures(timestamptz) to service_role;
