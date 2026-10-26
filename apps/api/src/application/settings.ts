import type { SettingsDto, UpdateSettingsInput } from '@aj/shared';
import { HoraInvalidaError } from '../domain/reminders.js';
import type { ProfileRepository, TaskRepository } from './ports.js';
import type { makeSyncReminders } from './sync-reminders.js';

export function makeSettingsUseCases(deps: {
  profiles: ProfileRepository;
  tasks: TaskRepository;
  syncReminders: ReturnType<typeof makeSyncReminders>;
}) {
  return {
    get(userId: string): Promise<SettingsDto> {
      return deps.profiles.get(userId);
    },

    async update(
      userId: string,
      input: UpdateSettingsInput,
    ): Promise<{ settings: SettingsDto; remindersRebuilt: number; remindersSkipped: number }> {
      const before = await deps.profiles.get(userId);
      const settings = await deps.profiles.update(userId, input);

      const affectsReminders =
        settings.timezone !== before.timezone || settings.earlyReminderMinutes !== before.earlyReminderMinutes;
      if (!affectsReminders) return { settings, remindersRebuilt: 0, remindersSkipped: 0 };

      let remindersRebuilt = 0;
      let remindersSkipped = 0;
      const open = await deps.tasks.list(userId, { status: ['pendente', 'em_andamento'] });
      for (const task of open) {
        if (task.dueDate === null) continue;
        try {
          await deps.syncReminders(userId, task, settings);
          remindersRebuilt += 1;
        } catch (error) {
          if (!(error instanceof HoraInvalidaError)) throw error;
          remindersSkipped += 1;
        }
      }
      return { settings, remindersRebuilt, remindersSkipped };
    },
  };
}
