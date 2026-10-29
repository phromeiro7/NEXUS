import type { IsoDate } from '@aj/shared';
import { addDays } from './calendar.js';
import { type LocalToUtcResult, localToUtc } from './timezone.js';

export class HoraInvalidaError extends Error {
  constructor(readonly reason: 'hora_inexistente' | 'hora_ambigua') {
    super(`Hora local inválida: ${reason}`);
    this.name = 'HoraInvalidaError';
  }
}

/** Fonte única dos tipos de lembrete; `reminders_kind_check` na migration deve listar exatamente estes. */
export const REMINDER_KINDS = ['tres_dias', 'dia_anterior', 'no_dia', 'antecipado', 'no_horario'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];
export type ReminderDraft = { kind: ReminderKind; scheduledAt: Date };

const DEFAULT_TIME = '08:00';
const FALLBACK_TIME = '09:00';

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
  const first = convert(date, DEFAULT_TIME, timeZone);
  if (first.ok) return first.utc;
  const second = convert(date, FALLBACK_TIME, timeZone);
  if (second.ok) return second.utc;
  throw new HoraInvalidaError(second.reason);
}

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
        scheduledAt: resolveDefaultReminderTime(addDays(dueDate, -3), timeZone),
      });
    }
    drafts.push(
      { kind: 'dia_anterior', scheduledAt: resolveDefaultReminderTime(addDays(dueDate, -1), timeZone) },
      { kind: 'no_dia', scheduledAt: resolveDefaultReminderTime(dueDate, timeZone) },
    );
  } else {
    // A hora escolhida pelo usuário nunca tem fallback: inexistente/ambígua é erro.
    const due = localToUtc(dueDate, dueTime, timeZone);
    if (!due.ok) throw new HoraInvalidaError(due.reason);
    // earlyMinutes 0 (ou negativo) não gera antecipado distinto: duplicaria `no_horario`.
    if (earlyMinutes !== null && earlyMinutes > 0) {
      drafts.push({
        kind: 'antecipado',
        scheduledAt: new Date(due.utc.getTime() - earlyMinutes * 60_000),
      });
    }
    drafts.push({ kind: 'no_horario', scheduledAt: due.utc });
  }

  return drafts
    .filter((d) => d.scheduledAt.getTime() > now.getTime())
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}
