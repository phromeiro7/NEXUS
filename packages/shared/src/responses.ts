import type { Holiday } from './deadline.js';
import type { IsoDate } from './primitives.js';
import type { SettingsDto } from './settings-api.js';

/** Tarefa cujos lembretes não puderam ser refeitos: a hora local não existe ou é ambígua no novo fuso. */
export type SkippedReminderTaskDto = {
  id: string;
  title: string;
  reason: 'hora_inexistente' | 'hora_ambigua';
};

/**
 * Resposta de `PATCH /settings`. `remindersSkipped` é `skipped.length`. Uma tarefa em `skipped`
 * mantém os lembretes calculados com o fuso/antecedência anteriores; o painel deve avisar o usuário.
 */
export type UpdateSettingsResultDto = {
  settings: SettingsDto;
  remindersRebuilt: number;
  remindersSkipped: number;
  skipped: SkippedReminderTaskDto[];
};

/** Resposta de `POST /deadlines/calculate`. */
export type CalculateDeadlineResultDto = {
  dueDate: IsoDate;
  prorrogado: boolean;
  feriadosDescontados: Holiday[];
};

/** Resposta de `POST /telegram/link-codes`: código de uso único, válido por 10 minutos. */
export type LinkCodeDto = { code: string; deepLink: string; expiresAt: string };

/** Resposta de `GET /me`. */
export type MeDto = { userId: string };
