import { z } from 'zod';

/** Hora do dia, `HH:mm` (00:00 a 23:59). */
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  message: 'Invalid time (HH:mm)',
});

/** Verdadeiro se `timeZone` é um fuso IANA conhecido pelo runtime. Nunca lança. */
export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== 'string' || timeZone.length === 0) return false;
  try {
    // O construtor lança RangeError para fuso desconhecido: é o teste mais fiel disponível.
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
