-- Initial schema. RLS policies are added in a later migration.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'America/Sao_Paulo',
  uf text,
  city text,
  early_reminder_minutes int not null default 15,
  briefing_time time not null default '08:00',
  last_briefing_sent_on date,
  telegram_chat_id bigint unique,
  channel_paused boolean not null default false,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  number text not null,
  client_name text,
  description text,
  status text not null default 'ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cases_status_check check (status in ('ativo', 'arquivado')),
  constraint cases_user_number_key unique (user_id, number),
  constraint cases_id_user_id_key unique (id, user_id)
);

create trigger cases_set_updated_at
  before update on public.cases
  for each row execute function public.set_updated_at();

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  case_id uuid,
  title text not null,
  type text not null default 'tarefa',
  status text not null default 'pendente',
  due_date date,
  due_time time,
  fatal boolean not null default false,
  source text not null default 'painel',
  source_text text,
  base_date date,
  period_days int,
  count_type text,
  completed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_id_user_id_key unique (id, user_id),
  constraint tasks_case_same_user_fkey foreign key (case_id, user_id)
    references public.cases (id, user_id) on delete set null (case_id),
  constraint tasks_title_check check (char_length(title) between 1 and 200),
  constraint tasks_type_check check (type in ('prazo', 'tarefa', 'audiencia')),
  constraint tasks_status_check check (status in ('pendente', 'em_andamento', 'concluida', 'cancelada')),
  constraint tasks_source_check check (source in ('painel', 'telegram')),
  constraint tasks_count_type_check check (count_type is null or count_type in ('uteis', 'corridos')),
  constraint tasks_due_time_needs_date_check check (due_time is null or due_date is not null)
);

create index tasks_user_status_due_idx
  on public.tasks (user_id, status, due_date)
  where deleted_at is null;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid not null,
  kind text not null,
  scheduled_at timestamptz not null,
  status text not null default 'pendente',
  attempts int not null default 0,
  last_error text,
  sent_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reminders_task_same_user_fkey foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete cascade,
  constraint reminders_status_check check (status in ('pendente', 'enviando', 'enviado', 'falhou', 'cancelado'))
);

create index reminders_status_scheduled_idx on public.reminders (status, scheduled_at);

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  scope text not null,
  name text not null,
  created_at timestamptz not null default now(),
  constraint holidays_scope_check check (scope in ('estadual', 'municipal')),
  constraint holidays_user_date_key unique (user_id, date)
);

create table public.inbound_events (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  external_id text not null,
  user_id uuid references public.profiles(id) on delete cascade,
  status text not null default 'pendente',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempt_count int not null default 0,
  created_at timestamptz not null default now(),
  constraint inbound_events_channel_external_id_key unique (channel, external_id)
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null,
  role text not null,
  content text not null,
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now(),
  constraint chat_messages_role_check check (role in ('user', 'assistant'))
);

create table public.link_codes (
  code text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.task_confirmations (
  channel text not null,
  chat_id bigint not null,
  message_id bigint not null,
  task_id uuid not null references public.tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel, chat_id, message_id, task_id)
);
