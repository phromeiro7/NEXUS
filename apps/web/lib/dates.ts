import type { IsoDate } from '@nexus/shared';

/** Milissegundos em um dia de 24 h (a aritmética de datas é feita em UTC, sem horário de verão). */
export const MS_PER_DAY = 86_400_000;
export const DAYS_PER_WEEK = 7;
/** Tamanho de "YYYY-MM-DD" no início de uma string ISO. */
const ISO_DATE_LENGTH = 10;

/*
 * Toda a aritmética de datas acontece em UTC à meia-noite: uma IsoDate é um dia do calendário, sem fuso,
 * e fazer contas em UTC evita que o horário de verão do navegador some ou tire uma hora (e mude o dia).
 */

function toUtcMs(date: IsoDate): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, ISO_DATE_LENGTH) as IsoDate;
}

/** `month` começa em 1; dia 0 do mês seguinte é o último dia do mês (o Date.UTC normaliza). */
function isoDateFromParts(year: number, month: number, day: number): IsoDate {
  return fromUtcMs(Date.UTC(year, month - 1, day));
}

/** Calendar day in the given IANA time zone. Throws RangeError on invalid zone. */
export function todayIn(timeZone: string, now: Date): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const getPart = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${getPart('year')}-${getPart('month')}-${getPart('day')}` as IsoDate;
}

/** Soma (ou subtrai, com valor negativo) dias de calendário. */
export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMs(toUtcMs(date) + days * MS_PER_DAY);
}

/** Days of the week with Monday = 0 ... Sunday = 6. */
function mondayIndex(date: IsoDate): number {
  // getUTCDay usa domingo = 0; somar 6 e tirar o resto por 7 desloca o início da semana para segunda.
  return (new Date(toUtcMs(date)).getUTCDay() + 6) % DAYS_PER_WEEK;
}

/** Semana (segunda a domingo) que contém a data. */
export function weekRange(date: IsoDate): { from: IsoDate; to: IsoDate } {
  const from = addDays(date, -mondayIndex(date));
  return { from, to: addDays(from, DAYS_PER_WEEK - 1) };
}

/** Primeiro e último dia do mês (`month` de 1 a 12). */
export function monthRange(year: number, month: number): { from: IsoDate; to: IsoDate } {
  return { from: isoDateFromParts(year, month, 1), to: isoDateFromParts(year, month + 1, 0) };
}

/** Grade do calendário do mês: semanas completas de segunda a domingo, incluindo dias dos meses vizinhos. */
export function monthGrid(year: number, month: number): IsoDate[][] {
  const { from, to } = monthRange(year, month);
  const start = weekRange(from).from;
  const end = weekRange(to).to;
  const weekCount = (daysBetween(start, end) + 1) / DAYS_PER_WEEK;
  return Array.from({ length: weekCount }, (_, week) =>
    Array.from({ length: DAYS_PER_WEEK }, (_, weekday) => addDays(start, week * DAYS_PER_WEEK + weekday)),
  );
}

/** Data por extenso em português ("segunda-feira, 9 de novembro de 2026"). */
export function formatLongDate(date: IsoDate): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(toUtcMs(date)));
}

/** "2026-11-09" → "09/11". */
export function formatShort(date: IsoDate): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** Dias de `from` até `to` (negativo quando `to` vem antes). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY);
}

/** `?d=` válido (YYYY-MM-DD de uma data real) ou null. */
export function parseAnchor(value: string | null): IsoDate | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = value as IsoDate;
  // Ida e volta pelo Date: "2026-02-30" vira "2026-03-02" e é recusada.
  return fromUtcMs(toUtcMs(date)) === date ? date : null;
}
