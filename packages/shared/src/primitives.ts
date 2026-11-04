import { z } from 'zod';

/** Plain calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(value: string): boolean {
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

// `format: 'date'` só afeta o JSON Schema gerado (ferramentas do assistente); a validação é o refine.
export const isoDateSchema: z.ZodType<IsoDate> = z
  .string()
  .refine(isRealDate, {
    message: 'Invalid ISO date (YYYY-MM-DD)',
  })
  .meta({ format: 'date' });

export const countTypeSchema = z.enum(['uteis', 'corridos']);
export type CountType = z.infer<typeof countTypeSchema>;
