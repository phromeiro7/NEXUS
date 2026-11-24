import type { SettingsDto, SkippedReminderTaskDto, UpdateSettingsInput, UpdateSettingsResultDto } from '@nexus/shared';
import { InvalidLocalTimeError } from '../domain/reminders.js';
import type { ProfileRepository, TaskRepository } from './ports.js';
import type { makeSyncReminders } from './sync-reminders.js';

/** Configurações do usuário; mudar fuso ou antecedência reconstrói os lembretes das tarefas abertas. */
export function makeSettingsUseCases(deps: {
  profiles: ProfileRepository;
  tasks: TaskRepository;
  syncReminders: ReturnType<typeof makeSyncReminders>;
}) {
  return {
    get(userId: string): Promise<SettingsDto> {
      return deps.profiles.get(userId);
    },

    async update(userId: string, input: UpdateSettingsInput): Promise<UpdateSettingsResultDto> {
      const settings = await deps.profiles.update(userId, input);

      // Reconstrói sempre que a requisição traz fuso ou antecedência, mesmo com o valor já gravado:
      // se uma reconstrução anterior falhou depois de gravar o perfil, reenviar o mesmo valor a completa.
      // A reconstrução é idempotente (um replacePending por tarefa aberta com data).
      const affectsReminders = input.timezone !== undefined || input.earlyReminderMinutes !== undefined;
      if (!affectsReminders) return { settings, remindersRebuilt: 0, remindersSkipped: 0, skipped: [] };

      let remindersRebuilt = 0;
      const skipped: SkippedReminderTaskDto[] = [];
      const openTasks = await deps.tasks.list(userId, { status: ['pendente', 'em_andamento'] });
      for (const task of openTasks) {
        if (task.dueDate === null) continue;
        try {
          await deps.syncReminders(userId, task, settings);
          remindersRebuilt += 1;
        } catch (error) {
          if (!(error instanceof InvalidLocalTimeError)) throw error;
          // A tarefa mantém os lembretes anteriores; o painel avisa o usuário a partir de `skipped`.
          skipped.push({ id: task.id, title: task.title, reason: error.reason });
        }
      }
      return { settings, remindersRebuilt, remindersSkipped: skipped.length, skipped };
    },
  };
}
