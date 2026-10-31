import { z } from 'zod';
import { isValidTimeZone, timeOfDaySchema } from './time-of-day.js';

export const updateSettingsInputSchema = z
  .object({
    timezone: z.string().refine(isValidTimeZone, { message: 'Invalid time zone' }).optional(),
    uf: z
      .string()
      .regex(/^[A-Z]{2}$/, { message: 'UF must be two uppercase letters' })
      .nullable()
      .optional(),
    city: z.string().trim().max(100).nullable().optional(),
    earlyReminderMinutes: z.number().int().min(0).max(1440).optional(),
    briefingTime: timeOfDaySchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one field is required',
  });
export type UpdateSettingsInput = z.infer<typeof updateSettingsInputSchema>;

export type SettingsDto = {
  timezone: string;
  uf: string | null;
  city: string | null;
  earlyReminderMinutes: number;
  briefingTime: string;
  telegramLinked: boolean;
  /** Canal pausado (bot bloqueado ou chat inexistente): lembretes e briefing deixam de sair até um novo vínculo. */
  channelPaused: boolean;
};
