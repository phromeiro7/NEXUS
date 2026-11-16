import type { IsoDate } from '@nexus/shared';

const MS_PER_DAY = 86_400_000;

function parse(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function format(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10) as IsoDate;
}

function ymd(year: number, month: number, day: number): IsoDate {
  return format(Date.UTC(year, month - 1, day));
}

/** Calendar day in the given IANA time zone. Throws RangeError on invalid zone. */
export function todayIn(timeZone: string, now: Date): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}` as IsoDate;
}

export function addDays(date: IsoDate, n: number): IsoDate {
  return format(parse(date) + n * MS_PER_DAY);
}

/** Days of the week with Monday = 0 ... Sunday = 6. */
function mondayIndex(date: IsoDate): number {
  return (new Date(parse(date)).getUTCDay() + 6) % 7;
}

export function weekRange(date: IsoDate): { from: IsoDate; to: IsoDate } {
  const from = addDays(date, -mondayIndex(date));
  return { from, to: addDays(from, 6) };
}

export function monthRange(year: number, month: number): { from: IsoDate; to: IsoDate } {
  return { from: ymd(year, month, 1), to: ymd(year, month + 1, 0) };
}

export function monthGrid(year: number, month: number): IsoDate[][] {
  const { from, to } = monthRange(year, month);
  const start = weekRange(from).from;
  const end = weekRange(to).to;
  const rows = (daysBetween(start, end) + 1) / 7;
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: 7 }, (_, c) => addDays(start, r * 7 + c)),
  );
}

export function formatLongDate(date: IsoDate): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(parse(date)));
}

export function formatShort(date: IsoDate): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((parse(b) - parse(a)) / MS_PER_DAY);
}

/** `?d=` válido (YYYY-MM-DD de uma data real) ou null. */
export function parseAnchor(value: string | null): IsoDate | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = value as IsoDate;
  return format(parse(date)) === date ? date : null;
}
