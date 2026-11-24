import type { IsoDate } from '@nexus/shared';
import { addDays } from './calendar.js';
import { type LocalToUtcResult, localToUtc } from './timezone.js';

/** Lançado quando a hora local de um lembrete não existe ou é ambígua no fuso (horário de verão). */
export class HoraInvalidaError extends Error {
  constructor(readonly reason: 'hora_inexistente' | 'hora_ambigua') {
    super(`Hora local inválida: ${reason}`);
    this.name = 'HoraInvalidaError';
  }
}

/** Fonte única dos tipos de lembrete; `reminders_kind_check` na migration deve listar exatamente estes. */
export const REMINDER_KINDS = ['tres_dias', 'dia_anterior', 'no_dia', 'antecipado', 'no_horario'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];
/** Lembrete calculado, ainda não gravado. */
export type ReminderDraft = { kind: ReminderKind; scheduledAt: Date };

const DEFAULT_TIME = '08:00';
const FALLBACK_TIME = '09:00';
const MS_PER_MINUTE = 60_000;
/** Prazo fatal sem hora ganha um aviso extra com esta antecedência. */
const FATAL_ADVANCE_NOTICE_DAYS = 3;

/**
 * Instante do lembrete escolhido pelo sistema para uma data: 08:00 local; se esse
 * horário não existir ou for ambíguo (horário de verão), 09:00. Se 09:00 também
 * falhar, lança `HoraInvalidaError`. `convert` existe para testar o fallback.
 */
export function resolveDefaultReminderTime(
  date: IsoDate,
  timeZone: string,
  convert: (date: IsoDate, time: string, timeZone: string) => LocalToUtcResult = localToUtc,
): Date {
  const defaultAttempt = convert(date, DEFAULT_TIME, timeZone);
  if (defaultAttempt.ok) return defaultAttempt.utc;
  const fallbackAttempt = convert(date, FALLBACK_TIME, timeZone);
  if (fallbackAttempt.ok) return fallbackAttempt.utc;
  throw new HoraInvalidaError(fallbackAttempt.reason);
}

/**
 * Calcula os lembretes de uma tarefa, em ordem cronológica e só os que ainda estão no futuro.
 * Sem hora: avisos às 08:00 (três dias antes se fatal, véspera e no dia). Com hora: antecipado
 * (se configurado) e no horário. Tarefa sem data não tem lembrete.
 */
export function buildReminders(input: {
  dueDate: IsoDate | null;
  dueTime: string | null;
  fatal: boolean;
  timeZone: string;
  earlyMinutes: number | null;
  now: Date;
}): ReminderDraft[] {
  const { dueDate, dueTime, fatal, timeZone, earlyMinutes, now } = input;
  if (dueDate === null) return [];

  const drafts: ReminderDraft[] = [];

  if (dueTime === null) {
    if (fatal) {
      drafts.push({
        kind: 'tres_dias',
        scheduledAt: resolveDefaultReminderTime(addDays(dueDate, -FATAL_ADVANCE_NOTICE_DAYS), timeZone),
      });
    }
    drafts.push(
      { kind: 'dia_anterior', scheduledAt: resolveDefaultReminderTime(addDays(dueDate, -1), timeZone) },
      { kind: 'no_dia', scheduledAt: resolveDefaultReminderTime(dueDate, timeZone) },
    );
  } else {
    // A hora escolhida pelo usuário nunca tem fallback: inexistente/ambígua é erro.
    const dueInstant = localToUtc(dueDate, dueTime, timeZone);
    if (!dueInstant.ok) throw new HoraInvalidaError(dueInstant.reason);
    // earlyMinutes 0 (ou negativo) não gera antecipado distinto: duplicaria `no_horario`.
    if (earlyMinutes !== null && earlyMinutes > 0) {
      drafts.push({
        kind: 'antecipado',
        scheduledAt: new Date(dueInstant.utc.getTime() - earlyMinutes * MS_PER_MINUTE),
      });
    }
    drafts.push({ kind: 'no_horario', scheduledAt: dueInstant.utc });
  }

  return drafts
    .filter((draft) => draft.scheduledAt.getTime() > now.getTime())
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}
