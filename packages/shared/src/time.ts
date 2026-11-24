import type { IsoDate } from './primitives.js';

/** Data de calendário de `now` no fuso IANA dado (nunca o fuso do servidor). */
export function todayIn(timeZone: string, now: Date): IsoDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const readPart = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${readPart('year')}-${readPart('month')}-${readPart('day')}`;
}
