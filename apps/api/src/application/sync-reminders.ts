import type { TaskDto } from '@nexus/shared';
import { buildReminders, type ReminderDraft } from '../domain/reminders.js';
import type { Clock, ProfileRecord, ReminderRepository } from './ports.js';

/** Parte pura: lembretes que a tarefa deve ter agora (vazio se encerrada ou sem data). */
export function remindersFor(task: TaskDto, profile: ProfileRecord, now: Date): ReminderDraft[] {
  if (task.status === 'concluida' || task.status === 'cancelada' || task.dueDate === null) return [];
  return buildReminders({
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    fatal: task.fatal,
    timeZone: profile.timezone,
    earlyMinutes: profile.earlyReminderMinutes,
    now,
  });
}

export function makeSyncReminders(deps: { reminders: ReminderRepository; clock: Clock }) {
  return async (userId: string, task: TaskDto, profile: ProfileRecord): Promise<void> => {
    await deps.reminders.replacePending(userId, task.id, remindersFor(task, profile, deps.clock.now()));
  };
}
