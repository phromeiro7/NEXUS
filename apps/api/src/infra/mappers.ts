import type { CaseDto, FinanceEntryDto, IsoDate, TaskDto } from '@aj/shared';

type Row = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Forma textual canônica de uuid; ids malformados são tratados como "não encontrado". */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** SQLSTATE `invalid_text_representation` (ex.: uuid malformado que passou pela guarda). */
export const INVALID_TEXT_REPRESENTATION = '22P02';

/** `HH:MM:SS` (Postgres `time`) -> `HH:mm`. */
export function toHourMinute(value: unknown): string | null {
  return value === null || value === undefined ? null : (value as string).slice(0, 5);
}

export function toIso(value: unknown): string | null {
  return value === null || value === undefined ? null : new Date(value as string).toISOString();
}

/** Mantém só as chaves definidas (`undefined` é ignorado; `null` é gravado). */
export function definedOnly(entries: Record<string, unknown>): Row {
  return Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== undefined));
}

export const TASK_COLUMNS =
  'id, case_id, title, type, status, due_date, due_time, fatal, base_date, period_days, count_type, completed_at, created_at, updated_at';

export function taskFromRow(row: Row): TaskDto {
  return {
    id: row.id as string,
    caseId: row.case_id as string | null,
    title: row.title as string,
    type: row.type as TaskDto['type'],
    status: row.status as TaskDto['status'],
    dueDate: row.due_date as IsoDate | null,
    dueTime: toHourMinute(row.due_time),
    fatal: row.fatal as boolean,
    baseDate: row.base_date as IsoDate | null,
    periodDays: row.period_days as number | null,
    countType: row.count_type as TaskDto['countType'],
    completedAt: toIso(row.completed_at),
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

export const CASE_COLUMNS = 'id, number, client_name, description, status, created_at, updated_at';

export function caseFromRow(row: Row): CaseDto {
  return {
    id: row.id as string,
    number: row.number as string,
    clientName: row.client_name as string | null,
    description: row.description as string | null,
    status: row.status as CaseDto['status'],
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

export const FINANCE_COLUMNS =
  'id, kind, description, amount_cents, category, due_date, status, reminder_time, paid_at, created_at, updated_at';

export function financeEntryFromRow(row: Row): FinanceEntryDto {
  return {
    id: row.id as string,
    kind: row.kind as FinanceEntryDto['kind'],
    description: row.description as string,
    // bigint chega como número no JSON do PostgREST; o teto do produto cabe com folga em 2^53.
    amountCents: Number(row.amount_cents),
    category: (row.category as string | null) ?? null,
    dueDate: row.due_date as IsoDate,
    status: row.status as FinanceEntryDto['status'],
    reminderTime: toHourMinute(row.reminder_time),
    paidAt: toIso(row.paid_at),
    createdAt: toIso(row.created_at) as string,
    updatedAt: toIso(row.updated_at) as string,
  };
}
