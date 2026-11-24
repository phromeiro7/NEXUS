import { z } from 'zod';

/** Data de calendário sem hora nem fuso, `YYYY-MM-DD`. */
export type IsoDate = string;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Formato certo E data que existe: `Date.UTC` normaliza 2025-02-30 para março, e a volta denuncia. */
function isRealDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  return normalized.getUTCFullYear() === year && normalized.getUTCMonth() === month - 1 && normalized.getUTCDate() === day;
}

// `format: 'date'` só afeta o JSON Schema gerado (ferramentas do assistente); a validação é o refine.
export const isoDateSchema: z.ZodType<IsoDate> = z
  .string()
  .refine(isRealDate, {
    message: 'Invalid ISO date (YYYY-MM-DD)',
  })
  .meta({ format: 'date' });

