import type { CaseDto, IsoDate, TaskDto } from '@aj/shared';

type Row = Record<string, unknown>;

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
