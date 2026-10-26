import type { CountType, IsoDate } from '@aj/shared';
import { addDays, isBusinessDay, isWeekend, nextBusinessDay } from './calendar.js';

export interface DeadlineInput {
  /** Data de publicação: o dia dela não entra na contagem. */
  baseDate: IsoDate;
  days: number;
  countType: CountType;
  holidays: ReadonlySet<IsoDate>;
}

export interface DeadlineResult {
  dueDate: IsoDate;
  prorrogado: boolean;
  /** Feriados em dia de semana entre baseDate (exclusive) e dueDate (inclusive). */
  feriadosDescontados: IsoDate[];
}

export function calculateDeadline(input: DeadlineInput): DeadlineResult {
  const { baseDate, days, countType, holidays } = input;
  let dueDate: IsoDate;
  let prorrogado = false;

  if (countType === 'uteis') {
    dueDate = baseDate;
    let counted = 0;
    while (counted < days) {
      dueDate = addDays(dueDate, 1);
      if (isBusinessDay(dueDate, holidays)) counted += 1;
    }
  } else {
    const raw = addDays(baseDate, days);
    dueDate = nextBusinessDay(raw, holidays);
    prorrogado = dueDate !== raw;
  }

  const feriadosDescontados: IsoDate[] = [];
  for (let cursor = addDays(baseDate, 1); cursor <= dueDate; cursor = addDays(cursor, 1)) {
    if (holidays.has(cursor) && !isWeekend(cursor)) feriadosDescontados.push(cursor);
  }

  return { dueDate, prorrogado, feriadosDescontados };
}
