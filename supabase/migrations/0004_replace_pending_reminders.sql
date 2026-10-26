-- Atomically replaces the pending reminders of one task.
--
-- Deletes only the task's 'pendente' reminders (for that user), then inserts
-- the drafts: [{ "kind": text, "scheduled_at": timestamptz-iso }, ...].
-- An in-flight 'enviando' reminder of the same kind is left alone: the insert
-- uses a bare ON CONFLICT DO NOTHING, so the partial unique index
-- reminders_task_kind_active_key skips the draft instead of failing.
-- '[]' only removes. A user/task pair that does not match fails on the
-- composite FK (23503); an invalid kind fails on the check (23514). Runs in
-- the caller's transaction, so a failure leaves nothing modified.
-- SECURITY INVOKER: only service_role (the API) may call it.

create or replace function public.replace_pending_reminders(
  p_user_id uuid,
  p_task_id uuid,
  p_drafts jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.reminders
   where task_id = p_task_id
     and user_id = p_user_id
     and status = 'pendente';

  insert into public.reminders (user_id, task_id, kind, scheduled_at)
  select p_user_id, p_task_id, d.kind, d.scheduled_at
    from jsonb_to_recordset(p_drafts) as d(kind text, scheduled_at timestamptz)
  on conflict do nothing;
end;
$$;

revoke all on function public.replace_pending_reminders(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_pending_reminders(uuid, uuid, jsonb)
  to service_role;
