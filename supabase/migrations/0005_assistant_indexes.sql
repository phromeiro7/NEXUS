-- Assistant persistence: indexes, stored reply and atomic inbound-event registration.

-- Context window (last N messages of a user in a channel) and rate limit
-- (events of a user in a channel since a cutoff).
create index chat_messages_user_channel_created_idx
  on public.chat_messages (user_id, channel, created_at desc);
create index inbound_events_user_channel_received_idx
  on public.inbound_events (user_id, channel, received_at desc);

-- Final reply stored so an idempotent resend gets the same answer back.
alter table public.inbound_events add column reply jsonb;
alter table public.inbound_events
  add constraint inbound_events_reply_size_check
  check (reply is null or octet_length(reply::text) < 65536);

-- Atomically registers an inbound event (unique per channel + external_id).
--
--   new event                    -> first_time true,  status 'recebido', reply null
--   existing, status 'falhou'    -> reset to 'recebido' (processed_at cleared,
--                                   attempt_count kept) and first_time true
--   existing, any other status   -> first_time false with the stored status/reply
--   existing with a user_id different from p_user_id (null counts as different
--   when the stored user is not null) -> raises 'evento_de_outro_usuario' and
--   returns nothing: another user's reply is never exposed
--   existing with null user_id and a non-null p_user_id -> adopted by p_user_id
--
-- INSERT ... ON CONFLICT DO NOTHING makes a concurrent register wait for the
-- first transaction; the following SELECT ... FOR UPDATE then sees its row and
-- serializes the 'falhou' reset, so exactly one caller gets first_time true.
-- SECURITY INVOKER: only service_role (the API) may call it.

create or replace function public.register_inbound_event(
  p_user_id uuid,
  p_channel text,
  p_external_id text,
  p_now timestamptz
)
returns table (first_time boolean, status text, reply jsonb)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inserted uuid;
  v_event public.inbound_events;
begin
  insert into public.inbound_events as e (user_id, channel, external_id, status, received_at)
  values (p_user_id, p_channel, p_external_id, 'recebido', p_now)
  on conflict (channel, external_id) do nothing
  returning e.id into v_inserted;

  if v_inserted is not null then
    return query select true, 'recebido'::text, null::jsonb;
    return;
  end if;

  select * into v_event
    from public.inbound_events e
   where e.channel = p_channel and e.external_id = p_external_id
     for update;
  if not found then
    raise exception 'evento_inexistente';
  end if;

  if v_event.user_id is not null and v_event.user_id is distinct from p_user_id then
    raise exception 'evento_de_outro_usuario';
  end if;

  if v_event.user_id is null and p_user_id is not null then
    update public.inbound_events e set user_id = p_user_id where e.id = v_event.id;
  end if;

  if v_event.status = 'falhou' then
    update public.inbound_events e
       set status = 'recebido', processed_at = null, received_at = p_now
     where e.id = v_event.id;
    return query select true, 'recebido'::text, null::jsonb;
    return;
  end if;

  return query select false, v_event.status, v_event.reply;
end;
$$;

revoke all on function public.register_inbound_event(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.register_inbound_event(uuid, text, text, timestamptz)
  to service_role;
