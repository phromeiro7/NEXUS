import type { IsoDate } from '@nexus/shared';

const pad = (n: number): string => String(n).padStart(2, '0');

function parts(date: IsoDate): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return [y, m, d];
}

/** Soma `n` dias (pode ser negativo) a uma data ISO, em UTC. */
export function addDays(date: IsoDate, n: number): IsoDate {
  const [y, m, d] = parts(date);
  const r = new Date(Date.UTC(y, m - 1, d + n));
  return `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())}` as IsoDate;
}

/** Dia da semana (0 = domingo ... 6 = sábado), em UTC. */
export function weekday(date: IsoDate): number {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekend(date: IsoDate): boolean {
  const w = weekday(date);
  return w === 0 || w === 6;
}

export function isBusinessDay(date: IsoDate, holidays: ReadonlySet<IsoDate>): boolean {
  return !isWeekend(date) && !holidays.has(date);
}

/** O próprio dia, se for útil; senão o próximo dia útil. */
export function nextBusinessDay(date: IsoDate, holidays: ReadonlySet<IsoDate>): IsoDate {
  let cursor = date;
  while (!isBusinessDay(cursor, holidays)) cursor = addDays(cursor, 1);
  return cursor;
}
