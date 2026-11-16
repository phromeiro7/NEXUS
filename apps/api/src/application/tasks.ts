import type { CreateTaskInput, ListTasksQuery, TaskDto, UpdateTaskInput } from '@nexus/shared';
import { applyStatusChange } from '../domain/task-status.js';
import type { makeCalculateDeadline } from './calculate-deadline.js';
import { ConflictError, InvalidInputError, NotFoundError } from './errors.js';
import type {
  CaseRepository,
  Clock,
  ProfileRepository,
  ReminderRepository,
  TaskPatch,
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

    async update(userId: string, id: string, input: UpdateTaskInput): Promise<TaskDto> {
      // (0) carrega a tarefa
      const current = await deps.tasks.get(userId, id);
      if (current === null) throw new NotFoundError('tarefa');

      // (1) tarefa encerrada só aceita `status` (reabrir)
      const closed = current.status === 'concluida' || current.status === 'cancelada';
      if (closed && Object.entries(input).some(([k, v]) => k !== 'status' && v !== undefined)) {
        throw new ConflictError('tarefa_encerrada');
      }

      const patch: TaskPatch = {};
      const now = deps.clock.now();

      // (2) status
      if (input.status !== undefined) {
        const next = applyStatusChange(
          { status: current.status, completedAt: current.completedAt === null ? null : new Date(current.completedAt) },
          input.status,
          now,
        );
        patch.status = next.status;
        patch.completedAt = next.completedAt === null ? null : next.completedAt.toISOString();
      }

      // (3) campos simples, processo, data/hora/regra do prazo
      if (input.title !== undefined) patch.title = input.title;
      if (input.type !== undefined) patch.type = input.type;
      if (input.fatal !== undefined) patch.fatal = input.fatal;
      if (input.caseId !== undefined) {
        if (input.caseId !== null && (await deps.cases.get(userId, input.caseId)) === null) {
          throw new NotFoundError('processo');
        }
        patch.caseId = input.caseId;
      }
      if (input.deadline !== undefined) {
        patch.dueDate = (await deps.calculateDeadline(userId, input.deadline)).dueDate;
        patch.baseDate = input.deadline.baseDate;
        patch.periodDays = input.deadline.days;
        patch.countType = input.deadline.countType;
        if (input.dueTime !== undefined) patch.dueTime = input.dueTime;
      } else if (input.dueDate !== undefined) {
        patch.dueDate = input.dueDate;
        // a regra deixa de explicar a data (nova data explícita) ou não tem mais data
        patch.baseDate = null;
        patch.periodDays = null;
        patch.countType = null;
        if (input.dueDate === null) patch.dueTime = input.dueTime ?? null;
        else if (input.dueTime !== undefined) patch.dueTime = input.dueTime;
      } else if (input.dueTime !== undefined) {
        patch.dueTime = input.dueTime;
      }

      const merged: TaskDto = { ...current, ...patch };
      if (merged.dueTime !== null && merged.dueDate === null) throw new InvalidInputError('hora_sem_data');

      // (4) lembretes calculados antes de gravar: HoraInvalidaError sobe sem estado gravado
      const profile = await deps.profiles.get(userId);
      remindersFor(merged, profile, now);

      // (5) grava
      const updated = await deps.tasks.update(userId, id, patch);
      if (updated === null) throw new NotFoundError('tarefa');

      // (6) refaz os lembretes só quando algo que os afeta mudou
      const affectsReminders =
        input.deadline !== undefined ||
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
