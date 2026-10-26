import { z } from 'zod';

/** Time of day, `HH:mm` (00:00 to 23:59). */
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  message: 'Invalid time (HH:mm)',
});

/** True when `tz` is an IANA time zone known to the runtime. Never throws. */
export function isValidTimeZone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
