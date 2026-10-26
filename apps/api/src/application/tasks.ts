import type { CreateTaskInput, ListTasksQuery, TaskDto } from '@aj/shared';
import type { makeCalculateDeadline } from './calculate-deadline.js';
import { NotFoundError } from './errors.js';
import type {
  CaseRepository,
  Clock,
  ProfileRepository,
  ReminderRepository,
  TaskRepository,
} from './ports.js';
import { makeSyncReminders, remindersFor } from './sync-reminders.js';

export function makeTaskUseCases(deps: {
  tasks: TaskRepository;
  cases: CaseRepository;
  profiles: ProfileRepository;
  reminders: ReminderRepository;
  calculateDeadline: ReturnType<typeof makeCalculateDeadline>;
  clock: Clock;
}) {
  const syncReminders = makeSyncReminders({ reminders: deps.reminders, clock: deps.clock });

  return {
    async create(
      userId: string,
      input: CreateTaskInput,
      source: 'painel' | 'telegram' = 'painel',
    ): Promise<TaskDto> {
      // (1) o processo precisa pertencer ao usuário
      if (input.caseId !== null && (await deps.cases.get(userId, input.caseId)) === null) {
        throw new NotFoundError('processo');
      }

      // (2) resolve a data a partir do prazo, quando houver
      let dueDate = input.dueDate ?? null;
      let baseDate: TaskDto['baseDate'] = null;
      let periodDays: TaskDto['periodDays'] = null;
      let countType: TaskDto['countType'] = null;
      if (input.deadline !== undefined) {
        dueDate = (await deps.calculateDeadline(userId, input.deadline)).dueDate;
        baseDate = input.deadline.baseDate;
        periodDays = input.deadline.days;
        countType = input.deadline.countType;
      }
      const type = input.type ?? (input.deadline !== undefined ? 'prazo' : 'tarefa');
      const fields = {
        caseId: input.caseId,
        title: input.title,
        type,
        status: 'pendente' as const,
        dueDate,
        dueTime: input.dueTime ?? null,
        fatal: input.fatal,
        baseDate,
        periodDays,
        countType,
        completedAt: null,
      };

      // (3) lembretes antes de gravar: HoraInvalidaError sobe sem estado gravado
      const profile = await deps.profiles.get(userId);
      const now = deps.clock.now();
      const draft: TaskDto = { ...fields, id: '', createdAt: now.toISOString(), updatedAt: now.toISOString() };
      remindersFor(draft, profile, now);

      // (4) grava
      const task = await deps.tasks.create(userId, { ...fields, source, sourceText: null });

      // (5) troca os lembretes; (6) se falhar, desfaz a criação e relança o erro original
      try {
        await syncReminders(userId, task, profile);
      } catch (error) {
        try {
          await deps.tasks.softDelete(userId, task.id, deps.clock.now());
        } catch {
          // a limpeza é best-effort; o erro original é o que importa
        }
        throw error;
      }
      return task;
    },

    async get(userId: string, id: string): Promise<TaskDto> {
      const task = await deps.tasks.get(userId, id);
      if (task === null) throw new NotFoundError('tarefa');
      return task;
    },

    list(userId: string, query: ListTasksQuery): Promise<TaskDto[]> {
      return deps.tasks.list(userId, query);
    },
  };
}
