import { z } from 'zod';
import { isValidTimeZone, timeOfDaySchema } from './time-of-day.js';

/** Antecedência máxima do lembrete antecipado: um dia. */
const MAX_EARLY_REMINDER_MINUTES = 24 * 60;

/** Corpo de `PATCH /settings`: só os campos enviados mudam; pelo menos um é obrigatório. */
export const updateSettingsInputSchema = z
  .object({
    timezone: z.string().refine(isValidTimeZone, { message: 'Invalid time zone' }).optional(),
    earlyReminderMinutes: z.number().int().min(0).max(MAX_EARLY_REMINDER_MINUTES).optional(),
    briefingTime: timeOfDaySchema.optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'At least one field is required',
  });
export type UpdateSettingsInput = z.infer<typeof updateSettingsInputSchema>;

/** Configurações da pessoa como a API devolve. */
export type SettingsDto = {
  timezone: string;
  earlyReminderMinutes: number;
  briefingTime: string;
  telegramLinked: boolean;
  /** Canal pausado (bot bloqueado ou chat inexistente): lembretes e briefing deixam de sair até um novo vínculo. */
  channelPaused: boolean;
};
