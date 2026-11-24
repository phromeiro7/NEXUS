import type { CreateTaskInput, ListTasksQuery, TaskDto, UpdateTaskInput } from '@nexus/shared';
import { applyStatusChange } from '../domain/task-status.js';
import { ConflictError, InvalidInputError, NotFoundError } from './errors.js';
import type {
  Clock,
  ProfileRepository,
  ReminderRepository,
  TaskPatch,
  TaskRepository,
} from './ports.js';
import { makeSyncReminders, computeRemindersForTask } from './sync-reminders.js';

/**
 * Casos de uso das tarefas. Toda escrita mantém os lembretes em sincronia: eles são calculados antes de
 * gravar (para falhar sem estado parcial) e, se a troca falhar depois, a gravação é desfeita.
 */
export function makeTaskUseCases(deps: {
  tasks: TaskRepository;
  profiles: ProfileRepository;
  reminders: ReminderRepository;
  clock: Clock;
}) {
  const syncReminders = makeSyncReminders({ reminders: deps.reminders, clock: deps.clock });

  return {
    async create(
      userId: string,
      input: CreateTaskInput,
      source: 'painel' | 'telegram' = 'painel',
    ): Promise<TaskDto> {
      const type = input.type ?? 'tarefa';
      const fields = {
        title: input.title,
        type,
        status: 'pendente' as const,
        dueDate: input.dueDate ?? null,
        dueTime: input.dueTime ?? null,
        fatal: input.fatal,
        completedAt: null,
      };

      // (1) lembretes antes de gravar: InvalidLocalTimeError sobe sem estado gravado
      const profile = await deps.profiles.get(userId);
      const now = deps.clock.now();
      const draft: TaskDto = { ...fields, id: '', createdAt: now.toISOString(), updatedAt: now.toISOString() };
      computeRemindersForTask(draft, profile, now);

      // (2) grava
      const task = await deps.tasks.create(userId, { ...fields, source, sourceText: null });

      // (3) troca os lembretes; (4) se falhar, desfaz a criação e relança o erro original
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

    async update(userId: string, id: string, input: UpdateTaskInput): Promise<TaskDto> {
      // (0) carrega a tarefa
      const current = await deps.tasks.get(userId, id);
      if (current === null) throw new NotFoundError('tarefa');

      // (1) tarefa encerrada só aceita `status` (reabrir)
      const isClosed = current.status === 'concluida' || current.status === 'cancelada';
      const changesMoreThanStatus = Object.entries(input).some(
        ([field, value]) => field !== 'status' && value !== undefined,
      );
      if (isClosed && changesMoreThanStatus) {
        throw new ConflictError('tarefa_encerrada');
      }

      const patch: TaskPatch = {};
      const now = deps.clock.now();

      // (2) status
      if (input.status !== undefined) {
        const nextState = applyStatusChange(
          { status: current.status, completedAt: current.completedAt === null ? null : new Date(current.completedAt) },
          input.status,
          now,
        );
        patch.status = nextState.status;
        patch.completedAt = nextState.completedAt === null ? null : nextState.completedAt.toISOString();
      }

      // (3) campos simples e data/hora
      if (input.title !== undefined) patch.title = input.title;
      if (input.type !== undefined) patch.type = input.type;
      if (input.fatal !== undefined) patch.fatal = input.fatal;
      // Tirar a data também tira a hora (hora sem data não existe); trocar a data preserva a hora atual.
      if (input.dueDate !== undefined) {
        patch.dueDate = input.dueDate;
        if (input.dueDate === null) patch.dueTime = input.dueTime ?? null;
        else if (input.dueTime !== undefined) patch.dueTime = input.dueTime;
      } else if (input.dueTime !== undefined) {
        patch.dueTime = input.dueTime;
      }

      const merged: TaskDto = { ...current, ...patch };
      if (merged.dueTime !== null && merged.dueDate === null) throw new InvalidInputError('hora_sem_data');

      // (4) lembretes calculados antes de gravar: InvalidLocalTimeError sobe sem estado gravado
      const profile = await deps.profiles.get(userId);
      computeRemindersForTask(merged, profile, now);

      // (5) grava
      const updated = await deps.tasks.update(userId, id, patch);
      if (updated === null) throw new NotFoundError('tarefa');

      // (6) refaz os lembretes só quando algo que os afeta mudou
      const affectsReminders =
        input.dueDate !== undefined ||
        input.dueTime !== undefined ||
        input.fatal !== undefined ||
        input.status !== undefined;
      if (!affectsReminders) return updated;
      try {
        await syncReminders(userId, updated, profile);
      } catch (error) {
        // (7) restaura o valor anterior de cada campo alterado e relança o erro original
        try {
          const previous: Record<string, unknown> = {};
          for (const key of Object.keys(patch) as (keyof TaskPatch)[]) previous[key] = current[key];
          await deps.tasks.update(userId, id, previous as TaskPatch);
        } catch {
          // a restauração é best-effort; o erro original é o que importa
        }
        throw error;
      }
      return updated;
    },

    async remove(userId: string, id: string): Promise<void> {
      if (!(await deps.tasks.softDelete(userId, id, deps.clock.now()))) throw new NotFoundError('tarefa');
      // Apaga primeiro, limpa depois. Se a limpeza falhar o erro sobe e a tarefa continua apagada:
      // o remetente (plano futuro) deve ignorar lembretes de tarefas apagadas/encerradas.
      await deps.reminders.replacePending(userId, id, []);
    },
  };
}
