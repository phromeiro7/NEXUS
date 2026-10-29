import { z } from 'zod';
import { countTypeSchema, isoDateSchema, type IsoDate } from './primitives.js';

export const calculateDeadlineInputSchema = z.object({
  baseDate: isoDateSchema,
  days: z.number().int().min(1).max(365),
  countType: countTypeSchema,
});
export type CalculateDeadlineInput = z.infer<typeof calculateDeadlineInputSchema>;

export type Holiday = { date: IsoDate; name: string };
