import { z } from 'zod';
import { isoDateSchema, type IsoDate } from './primitives.js';

export const holidayScopeSchema = z.enum(['estadual', 'municipal']);
export type HolidayScope = z.infer<typeof holidayScopeSchema>;

export const createHolidayInputSchema = z.object({
  date: isoDateSchema,
  scope: holidayScopeSchema,
  name: z.string().trim().min(1).max(100),
});
export type CreateHolidayInput = z.infer<typeof createHolidayInputSchema>;

export type HolidayDto = {
  id: string;
  date: IsoDate;
  scope: HolidayScope;
  name: string;
};
