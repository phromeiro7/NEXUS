import type { FinanceEntryDto, IsoDate, TaskDto } from '@nexus/shared';

/** Linha crua do PostgREST: as colunas chegam sem tipo e são convertidas campo a campo. */
type Row = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Forma textual canônica de uuid; ids malformados são tratados como "não encontrado". */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** SQLSTATE `invalid_text_representation` (ex.: uuid malformado que passou pela guarda). */
export const INVALID_TEXT_REPRESENTATION = '22P02';

/** `HH:MM:SS` (Postgres `time`) -> `HH:mm`. */
export function toHourMinute(value: unknown): string | null {
  return value === null || value === undefined ? null : (value as string).slice(0, 5);
}

/** Timestamp do Postgres -> ISO 8601 em UTC; `null`/ausente continua `null`. */
export function toIso(value: unknown): string | null {
  return value === null || value === undefined ? null : new Date(value as string).toISOString();
}

/** Mantém só as chaves definidas (`undefined` é ignorado; `null` é gravado). */
export function definedOnly(entries: Record<string, unknown>): Row {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
}

/** Colunas lidas de `tasks`; precisam cobrir tudo o que `taskFromRow` usa. */
export const TASK_COLUMNS =
  'id, title, type, status, due_date, due_time, fatal, completed_at, created_at, updated_at';

/** Linha de `tasks` -> `TaskDto` (snake_case -> camelCase, horas e datas normalizadas). */
export function taskFromRow(row: Row): TaskDto {
  return {
    id: row.id as string,
    title: row.title as string,
    type: row.type as TaskDto['type'],
    status: row.status as TaskDto['status'],
    dueDate: row.due_date as IsoDate | null,
    dueTime: toHourMinute(row.due_time),
    fatal: row.fatal as boolean,
    completedAt: toIso(row.completed_at),
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

/** Colunas lidas de `finance_entries`; precisam cobrir tudo o que `financeEntryFromRow` usa. */
export const FINANCE_COLUMNS =
  'id, kind, description, amount_cents, category, due_date, status, reminder_time, paid_at, created_at, updated_at';

/** Linha de `finance_entries` -> `FinanceEntryDto`. */
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
