import type { Holiday, IsoDate } from '@aj/shared';

const pad = (n: number): string => String(n).padStart(2, '0');

function toIso(year: number, month: number, day: number): IsoDate {
  return `${year}-${pad(month)}-${pad(day)}` as IsoDate;
}

/** Páscoa (calendário gregoriano) pelo algoritmo de Meeus/Jones/Butcher. */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIso(year, month, day);
}

const FIXED: ReadonlyArray<readonly [string, string]> = [
  ['01-01', 'Confraternização Universal'],
  ['04-21', 'Tiradentes'],
  ['05-01', 'Dia do Trabalho'],
  ['09-07', 'Independência do Brasil'],
  ['10-12', 'Nossa Senhora Aparecida'],
  ['11-02', 'Finados'],
  ['11-15', 'Proclamação da República'],
  ['11-20', 'Dia da Consciência Negra'],
  ['12-25', 'Natal'],
];

/** Feriados nacionais do ano, ordenados por data. Carnaval e Corpus Christi são ponto facultativo e ficam de fora. */
export function nationalHolidays(year: number): Holiday[] {
  const [, em, ed] = easterSunday(year).split('-').map(Number) as [number, number, number];
  // Sexta-feira Santa = Páscoa - 2 dias, em UTC (independe do fuso da máquina).
  const gf = new Date(Date.UTC(year, em - 1, ed - 2));
  const goodFriday: Holiday = {
    date: toIso(gf.getUTCFullYear(), gf.getUTCMonth() + 1, gf.getUTCDate()),
    name: 'Sexta-feira Santa',
  };
  const fixed: Holiday[] = FIXED.map(([md, name]) => ({
    date: `${year}-${md}` as IsoDate,
    name,
  }));
  return [...fixed, goodFriday].sort((x, y) => x.date.localeCompare(y.date));
}
