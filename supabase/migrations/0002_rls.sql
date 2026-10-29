-- Row level security and table privileges.
--
-- Supabase grants ALL on new public tables to anon and authenticated by
-- default (including TRUNCATE, which RLS does not cover). We revoke
-- everything from anon/authenticated/public first and then grant back only
-- what each policy needs, so the end state is deterministic.
-- service_role (BYPASSRLS) keeps its full grants: the API uses it.

-- 1. RLS on every table.
alter table public.profiles enable row level security;
alter table public.cases enable row level security;
alter table public.tasks enable row level security;
alter table public.reminders enable row level security;
alter table public.holidays enable row level security;
alter table public.inbound_events enable row level security;
alter table public.chat_messages enable row level security;
alter table public.link_codes enable row level security;
alter table public.task_confirmations enable row level security;

-- 2. Start from zero for the client-facing roles.
revoke all on table
  public.profiles,
  public.cases,
  public.tasks,
  public.reminders,
  public.holidays,
  public.inbound_events,
  public.chat_messages,
  public.link_codes,
  public.task_confirmations
from public, anon, authenticated;

-- Functions are not meant to be called by clients either.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- 3. Minimal grants for authenticated (anon gets nothing).
grant select, insert, update, delete on table public.cases to authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;
grant select, insert, update, delete on table public.holidays to authenticated;
grant select on table public.reminders to authenticated;
grant select on table public.profiles to authenticated;
grant update (timezone, uf, city, early_reminder_minutes, briefing_time)
  on table public.profiles to authenticated;

-- inbound_events, chat_messages, link_codes, task_confirmations: no grants,
-- no policies; only service_role touches them.

-- 4. Policies (all to authenticated, all scoped to the caller).
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy cases_select_own on public.cases
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy cases_insert_own on public.cases
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy cases_update_own on public.cases
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy cases_delete_own on public.cases
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy tasks_select_own on public.tasks
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy tasks_insert_own on public.tasks
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy tasks_update_own on public.tasks
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy tasks_delete_own on public.tasks
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy holidays_select_own on public.holidays
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy holidays_insert_own on public.holidays
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy holidays_update_own on public.holidays
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy holidays_delete_own on public.holidays
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy reminders_select_own on public.reminders
  for select to authenticated
  using (user_id = (select auth.uid()));
