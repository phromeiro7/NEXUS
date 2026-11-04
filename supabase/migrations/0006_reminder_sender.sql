-- Reminder sender support: queue (claim / retry / recovery), Telegram link code,
-- briefing claim and housekeeping. Every function is SECURITY INVOKER with a
-- pinned search_path, uses no dynamic SQL and is executable only by service_role
-- (the API). The caller supplies the clock (p_now) so behaviour is testable.

-- When a transient send failure schedules a retry; null means "at scheduled_at".
alter table public.reminders add column next_attempt_at timestamptz;

-- Serves claim_due_reminders: pending reminders in due order.
create index reminders_pending_due_idx
  on public.reminders ((coalesce(next_attempt_at, scheduled_at)))
  where status = 'pendente';

-- Atomically reserves up to p_limit due reminders. Only reminders of a task that
-- is alive (deleted_at is null) and open (pendente / em_andamento), owned by a
-- profile with a linked Telegram chat and an active channel, are reserved.
-- FOR UPDATE OF r SKIP LOCKED: simultaneous callers never get the same row and
-- never wait for each other. Reserved rows become 'enviando' with locked_at =
-- p_now and attempts + 1. Oldest first.
create or replace function public.claim_due_reminders(p_now timestamptz, p_limit int)
returns table (
  reminder_id uuid,
  user_id uuid,
  task_id uuid,
  kind text,
  scheduled_at timestamptz,
  attempts int,
  title text,
  task_type text,
  due_date date,
  due_time time,
  fatal boolean,
  telegram_chat_id bigint,
  timezone text
)
language sql
security invoker
set search_path = public
as $$
  with picked as (
    select r.id
      from public.reminders r
      join public.tasks t on t.id = r.task_id and t.user_id = r.user_id
      join public.profiles p on p.id = r.user_id
     where r.status = 'pendente'
       and coalesce(r.next_attempt_at, r.scheduled_at) <= p_now
       and r.scheduled_at >= p_now - interval '24 hours'
       and t.deleted_at is null
       and t.status in ('pendente', 'em_andamento')
       and p.telegram_chat_id is not null
       and not p.channel_paused
     order by coalesce(r.next_attempt_at, r.scheduled_at), r.id
     limit greatest(coalesce(p_limit, 0), 0)
       for update of r skip locked
  ),
  claimed as (
    update public.reminders r
       set status = 'enviando',
           locked_at = p_now,
           attempts = r.attempts + 1
      from picked
     where r.id = picked.id
    returning r.id, r.user_id, r.task_id, r.kind, r.scheduled_at, r.attempts,
              coalesce(r.next_attempt_at, r.scheduled_at) as due_at
  )
  select c.id, c.user_id, c.task_id, c.kind, c.scheduled_at, c.attempts,
         t.title, t.type, t.due_date, t.due_time, t.fatal,
         p.telegram_chat_id, p.timezone
    from claimed c
    join public.tasks t on t.id = c.task_id and t.user_id = c.user_id
    join public.profiles p on p.id = c.user_id
   order by c.due_at, c.id;
$$;

-- Cancels pending reminders that must never be sent: the task was deleted or
-- closed, or the reminder is more than 24 hours late. Returns how many.
create or replace function public.cancel_dead_reminders(p_now timestamptz)
returns int
language sql
security invoker
set search_path = public
as $$
  with cancelled as (
    update public.reminders r
       set status = 'cancelado',
           locked_at = null,
           last_error = case
             when exists (
               select 1 from public.tasks t
                where t.id = r.task_id and t.user_id = r.user_id
                  and t.deleted_at is null and t.status in ('pendente', 'em_andamento')
             ) then 'atrasado_demais'
             else 'tarefa_encerrada'
           end
     where r.status = 'pendente'
       and (
         r.scheduled_at < p_now - interval '24 hours'
         or not exists (
           select 1 from public.tasks t
            where t.id = r.task_id and t.user_id = r.user_id
              and t.deleted_at is null and t.status in ('pendente', 'em_andamento')
         )
       )
    returning 1
  )
  select count(*)::int from cancelled;
$$;

-- A reminder stuck in 'enviando' for more than 5 minutes (the sender died) goes
-- back to 'pendente'. attempts is kept so the retry budget still counts it.
create or replace function public.recover_stuck_reminders(p_now timestamptz)
returns int
language sql
security invoker
set search_path = public
as $$
  with recovered as (
    update public.reminders r
       set status = 'pendente', locked_at = null
     where r.status = 'enviando'
       and r.locked_at < p_now - interval '5 minutes'
    returning 1
  )
  select count(*)::int from recovered;
$$;

-- Records the outcome of a send. Only from 'enviando', and only by the current
-- claimer: p_attempts is the attempts value claim_due_reminders returned. Every
-- new claim increments attempts and recovery never changes it, so it acts as a
-- fencing token: a sender whose lease expired (recovered and re-claimed by
-- another sender) can no longer finish the row.
--   p_status: 'enviado' (sets sent_at), 'pendente' (retry, requires
--   p_next_attempt_at), 'falhou' or 'cancelado'. The lock is always cleared and
--   last_error is cut to 200 characters.
-- Raises, in this order: 'status_invalido', 'lembrete_sem_proxima_tentativa'
-- (retry without a time), then under a row lock 'lembrete_inexistente',
-- 'lembrete_em_estado_invalido' (not 'enviando') and
-- 'lembrete_reservado_por_outro' (attempts differ).
create or replace function public.finish_reminder(
  p_id uuid,
  p_attempts int,
  p_status text,
  p_error text,
  p_next_attempt_at timestamptz,
  p_now timestamptz
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
  v_attempts int;
begin
  if p_status is null or p_status not in ('enviado', 'pendente', 'falhou', 'cancelado') then
    raise exception 'status_invalido';
  end if;
  if p_status = 'pendente' and p_next_attempt_at is null then
    raise exception 'lembrete_sem_proxima_tentativa';
  end if;

  select r.status, r.attempts into v_status, v_attempts
    from public.reminders r
   where r.id = p_id
     for update;
  if not found then
    raise exception 'lembrete_inexistente';
  end if;
  if v_status <> 'enviando' then
    raise exception 'lembrete_em_estado_invalido';
  end if;
  if v_attempts is distinct from p_attempts then
    raise exception 'lembrete_reservado_por_outro';
  end if;

  update public.reminders r
     set status = p_status,
         sent_at = case when p_status = 'enviado' then p_now else r.sent_at end,
         next_attempt_at = case when p_status = 'pendente' then p_next_attempt_at else null end,
         last_error = left(p_error, 200),
         locked_at = null
   where r.id = p_id;
end;
$$;

-- Links a Telegram chat to the account that generated the code, in one
-- transaction.
--   valid, unexpired code        -> code deleted (single use), telegram_chat_id
--                                   set, channel_paused cleared -> ('ok', user)
--   unknown or expired code      -> ('invalido', null); an expired code never links
--   chat linked to ANOTHER user  -> ('chat_em_uso', null); the code is NOT consumed
-- The code row is locked, so two simultaneous consumptions of one code give
-- exactly one 'ok'. A race between two accounts for the same chat is settled by
-- the unique index on profiles.telegram_chat_id (the loser is 'chat_em_uso' and
-- its code stays valid).
create or replace function public.consume_link_code(
  p_code text,
  p_chat_id bigint,
  p_now timestamptz
)
returns table (status text, user_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid;
begin
  select c.user_id into v_user
    from public.link_codes c
   where c.code = p_code and c.expires_at > p_now
     for update;
  if not found then
    return query select 'invalido'::text, null::uuid;
    return;
  end if;

  if exists (
    select 1 from public.profiles p
     where p.telegram_chat_id = p_chat_id and p.id <> v_user
  ) then
    return query select 'chat_em_uso'::text, null::uuid;
    return;
  end if;

  begin
    update public.profiles p
       set telegram_chat_id = p_chat_id, channel_paused = false
     where p.id = v_user;
  exception when unique_violation then
    return query select 'chat_em_uso'::text, null::uuid;
    return;
  end;

  delete from public.link_codes c where c.code = p_code;
  return query select 'ok'::text, v_user;
end;
$$;

-- Briefing: at most once per local day. true only if this call took the day.
create or replace function public.claim_briefing(p_user_id uuid, p_local_date date)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.profiles p
     set last_briefing_sent_on = p_local_date
   where p.id = p_user_id
     and (p.last_briefing_sent_on is null or p.last_briefing_sent_on < p_local_date);
  return found;
end;
$$;

-- Undoes a claim after a TRANSIENT send failure so the next run retries: only
-- where the stored day is exactly p_local_date.
create or replace function public.release_briefing(p_user_id uuid, p_local_date date)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.profiles p
     set last_briefing_sent_on = p_local_date - 1
   where p.id = p_user_id
     and p.last_briefing_sent_on = p_local_date;
$$;

-- Housekeeping. Each returns how many rows it deleted.
create or replace function public.purge_expired_chat_messages(p_now timestamptz)
returns int
language sql
security invoker
set search_path = public
as $$
  with gone as (
    delete from public.chat_messages m where m.expires_at < p_now returning 1
  )
  select count(*)::int from gone;
$$;

create or replace function public.purge_expired_link_codes(p_now timestamptz)
returns int
language sql
security invoker
set search_path = public
as $$
  with gone as (
    delete from public.link_codes c where c.expires_at < p_now returning 1
  )
  select count(*)::int from gone;
$$;

-- The message rate limit only looks at the last hour; two days is plenty.
create or replace function public.purge_old_model_calls(p_now timestamptz)
returns int
language sql
security invoker
set search_path = public
as $$
  with gone as (
    delete from public.assistant_model_calls m
     where m.called_at < p_now - interval '2 days'
    returning 1
  )
  select count(*)::int from gone;
$$;

-- Events stuck in 'recebido' / 'processando' for more than 2 minutes (the API
-- died mid-request).
--   attempt_count >= 1 (the model was called, tools may have written): stored
--     as a terminal 'processado' with a truthful partial reply, so a resend
--     replays it and can never create anything twice;
--   attempt_count = 0: 'falhou', which register_inbound_event lets be resent.
-- One UPDATE: a concurrent recovery waits on the row, re-checks the status and
-- skips it, so each event is counted once.
create or replace function public.recover_stuck_events(p_now timestamptz)
returns table (recovered int, failed int)
language sql
security invoker
set search_path = public
as $$
  with updated as (
    update public.inbound_events e
       set status = case when e.attempt_count >= 1 then 'processado' else 'falhou' end,
           reply = case
             when e.attempt_count >= 1 then jsonb_build_object(
               'reply',
               'Sua mensagem pode ter sido processada só em parte. Confira suas tarefas e envie de novo o que faltar.',
               'affectedTasks',
               '[]'::jsonb
             )
             else e.reply
           end,
           processed_at = case when e.attempt_count >= 1 then p_now else e.processed_at end
     where e.status in ('recebido', 'processando')
       and e.received_at < p_now - interval '2 minutes'
    returning e.attempt_count >= 1 as had_model_call
  )
  select (count(*) filter (where had_model_call))::int,
         (count(*) filter (where not had_model_call))::int
    from updated;
$$;

revoke all on function public.claim_due_reminders(timestamptz, int) from public, anon, authenticated;
revoke all on function public.cancel_dead_reminders(timestamptz) from public, anon, authenticated;
revoke all on function public.recover_stuck_reminders(timestamptz) from public, anon, authenticated;
revoke all on function public.finish_reminder(uuid, int, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_link_code(text, bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_briefing(uuid, date) from public, anon, authenticated;
revoke all on function public.release_briefing(uuid, date) from public, anon, authenticated;
revoke all on function public.purge_expired_chat_messages(timestamptz) from public, anon, authenticated;
revoke all on function public.purge_expired_link_codes(timestamptz) from public, anon, authenticated;
revoke all on function public.purge_old_model_calls(timestamptz) from public, anon, authenticated;
revoke all on function public.recover_stuck_events(timestamptz) from public, anon, authenticated;

grant execute on function public.claim_due_reminders(timestamptz, int) to service_role;
grant execute on function public.cancel_dead_reminders(timestamptz) to service_role;
grant execute on function public.recover_stuck_reminders(timestamptz) to service_role;
grant execute on function public.finish_reminder(uuid, int, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.consume_link_code(text, bigint, timestamptz) to service_role;
grant execute on function public.claim_briefing(uuid, date) to service_role;
grant execute on function public.release_briefing(uuid, date) to service_role;
grant execute on function public.purge_expired_chat_messages(timestamptz) to service_role;
grant execute on function public.purge_expired_link_codes(timestamptz) to service_role;
grant execute on function public.purge_old_model_calls(timestamptz) to service_role;
grant execute on function public.recover_stuck_events(timestamptz) to service_role;
