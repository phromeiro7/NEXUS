-- Numbered 0007: the local stack already carries 0005 (assistant_indexes) and 0006 (reminder_sender)
-- from the feat/plano-4 and feat/plano-5 branches, which are not merged into main yet.

-- Personal finance entries (gastos, contas a pagar, entradas).
--
-- One row per entry. Money is stored as integer cents (bigint, so the product
-- limit of R$ 999.999.999,99 fits); never floating point. `due_date` is the
-- day the entry happened, or the due date while it is still 'a_pagar'.
-- Like the other tables: RLS on, minimal grants to authenticated, and the API
-- (service_role) is the only writer in practice. The Telegram link and the
-- reminders for bills are a later step: `reminder_time` is only stored here.

create table public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  description text not null,
  amount_cents bigint not null,
  category text,
  due_date date not null,
  status text not null default 'paga',
  reminder_time time,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Must equal financeKindSchema / financeStatusSchema in packages/shared/src/finance-api.ts.
  constraint finance_entries_kind_check check (kind in ('gasto', 'conta', 'entrada')),
  constraint finance_entries_status_check check (status in ('paga', 'a_pagar')),
  constraint finance_entries_description_check check (char_length(description) between 1 and 120),
  constraint finance_entries_amount_check check (amount_cents between 1 and 99999999999),
  constraint finance_entries_category_check check (category is null or char_length(category) between 1 and 40),
  -- A gasto is money already spent. reminder_time may stay on a paid entry so that undoing a payment
  -- keeps it; the future sender only looks at 'a_pagar'.
  constraint finance_entries_gasto_paid_check check (kind <> 'gasto' or status = 'paga'),
  constraint finance_entries_paid_at_check check ((status = 'paga') = (paid_at is not null))
);

create index finance_entries_user_due_idx on public.finance_entries (user_id, due_date);

-- Open items across months (overdue bills of earlier months).
create index finance_entries_user_open_idx
  on public.finance_entries (user_id, due_date)
  where status = 'a_pagar';

create trigger finance_entries_set_updated_at
  before update on public.finance_entries
  for each row execute function public.set_updated_at();

alter table public.finance_entries enable row level security;

revoke all on table public.finance_entries from public, anon, authenticated;
grant select, insert, update, delete on table public.finance_entries to authenticated;

create policy finance_entries_select_own on public.finance_entries
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy finance_entries_insert_own on public.finance_entries
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy finance_entries_update_own on public.finance_entries
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy finance_entries_delete_own on public.finance_entries
  for delete to authenticated
  using (user_id = (select auth.uid()));
