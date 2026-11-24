import type { IsoDate } from '@nexus/shared';

const padTwoDigits = (value: number): string => String(value).padStart(2, '0');

function splitIsoDate(date: IsoDate): [year: number, month: number, day: number] {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return [year, month, day];
}

/** Soma `days` dias (pode ser negativo) a uma data ISO, em UTC. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [year, month, day] = splitIsoDate(date);
  // `Date.UTC` normaliza o dia excedente para o mês/ano seguinte (ou anterior).
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear()}-${padTwoDigits(result.getUTCMonth() + 1)}-${padTwoDigits(result.getUTCDate())}` as IsoDate;
}

/** Dia da semana (0 = domingo ... 6 = sábado), em UTC. */
export function weekdayOf(date: IsoDate): number {
  const [year, month, day] = splitIsoDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
