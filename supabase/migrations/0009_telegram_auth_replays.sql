-- Telegram Mini App login: every signed `initData` may open a session only once. The API records the
-- hash (the Telegram signature, 64 hex chars) of each `initData` it accepted; a second attempt with the
-- same hash is refused ("ja_utilizado"). The hash is a public signature, not a secret, and says nothing
-- about the user.
--
-- Closed table like the other Telegram tables: RLS on, no client grants (service_role only, via the API).
-- A row can be dropped once the `auth_date` window has passed, because the API already refuses an expired
-- `initData`; the scheduler purges rows older than a day (the window is at most 24 h).

create table public.telegram_auth_replays (
  hash text primary key,
  seen_at timestamptz not null default now(),
  constraint telegram_auth_replays_hash_check check (hash ~ '^[0-9a-f]{64}$')
);

create index telegram_auth_replays_seen_idx on public.telegram_auth_replays (seen_at);

alter table public.telegram_auth_replays enable row level security;
revoke all on table public.telegram_auth_replays from public, anon, authenticated;

-- Deletes rows older than one day; returns how many. SECURITY INVOKER: only service_role may call it.
create function public.purge_telegram_auth_replays(p_now timestamptz)
returns integer
language sql
as $$
  with gone as (
    delete from public.telegram_auth_replays where seen_at < p_now - interval '1 day' returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.purge_telegram_auth_replays(timestamptz) from public, anon, authenticated;
grant execute on function public.purge_telegram_auth_replays(timestamptz) to service_role;
