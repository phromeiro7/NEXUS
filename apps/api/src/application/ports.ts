import type {
  CaseDto,
  CreateCaseInput,
  CreateHolidayInput,
  FinanceEntryDto,
  ListFinanceEntriesQuery,
  Holiday,
  HolidayDto,
  IsoDate,
  ListTasksQuery,
  SettingsDto,
  TaskDto,
  UpdateCaseInput,
  UpdateSettingsInput,
} from '@aj/shared';
import type { ReminderDraft } from '../domain/reminders.js';

/*
 * Contrato comum a todas as portas: todo método recebe `userId` primeiro e NUNCA
 * devolve nem altera linhas de outro usuário.
 */

export type HolidayRepository = {
  /** Feriados cadastrados pelo usuário com data entre `from` e `to` (inclusive). */
  listByUser(userId: string, from: IsoDate, to: IsoDate): Promise<Holiday[]>;
};

export interface HolidayAdminRepository {
  list(userId: string): Promise<HolidayDto[]>;
  /** Lança `ConflictError('feriado_ja_cadastrado')` se o usuário já tem feriado nessa data. */
  create(userId: string, input: CreateHolidayInput): Promise<HolidayDto>;
  /** `true` somente se um feriado desse usuário foi removido. */
  remove(userId: string, id: string): Promise<boolean>;
}

export type NewTask = Omit<TaskDto, 'id' | 'createdAt' | 'updatedAt'> & {
  source: 'painel' | 'telegram';
  sourceText: string | null;
};
export type TaskPatch = Partial<Omit<TaskDto, 'id' | 'createdAt' | 'updatedAt'>>;

export interface TaskRepository {
  create(userId: string, task: NewTask): Promise<TaskDto>;
  /** Nunca devolve tarefa apagada (soft delete). */
  get(userId: string, id: string): Promise<TaskDto | null>;
  /**
   * Nunca devolve tarefas apagadas. Filtros: `from`/`to` (inclusivos, sobre `dueDate`;
   * tarefa sem data nunca casa com intervalo), `status` (indefinido ou vazio = sem filtro),
   * `caseId`, `withoutDate` (só `dueDate === null`). Ordem: `dueDate` asc (nulos por último),
   * `dueTime` (nulo por último), `createdAt`.
   */
  list(userId: string, query: ListTasksQuery): Promise<TaskDto[]>;
  /** `null` se o id não existe para o usuário (ou foi apagado); senão a tarefa atualizada. */
  update(userId: string, id: string, patch: TaskPatch): Promise<TaskDto | null>;
  /** `true` somente se uma tarefa viva do usuário foi apagada. */
  softDelete(userId: string, id: string, now: Date): Promise<boolean>;
}

export interface CaseRepository {
  /** Lança `ConflictError('numero_ja_cadastrado')` se o usuário repete `number`. */
  create(userId: string, input: CreateCaseInput): Promise<CaseDto>;
  get(userId: string, id: string): Promise<CaseDto | null>;
  list(userId: string, filter: { status?: 'ativo' | 'arquivado' }): Promise<CaseDto[]>;
  /** `null` se não existe para o usuário; `ConflictError('numero_ja_cadastrado')` se `number` colide. */
  update(userId: string, id: string, patch: UpdateCaseInput): Promise<CaseDto | null>;
}

export type ProfileRecord = SettingsDto;

export interface ProfileRepository {
  /** Configurações de um usuário que possui perfil. */
  get(userId: string): Promise<ProfileRecord>;
  update(userId: string, patch: UpdateSettingsInput): Promise<ProfileRecord>;
}

export interface ReminderRepository {
  /** Substitui os lembretes pendentes dessa tarefa, para esse usuário, por `drafts`. */
  replacePending(userId: string, taskId: string, drafts: ReminderDraft[]): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export type NewFinanceEntry = Omit<FinanceEntryDto, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };
export type FinanceEntryPatch = Partial<
  Pick<FinanceEntryDto, 'description' | 'amountCents' | 'category' | 'dueDate' | 'status' | 'reminderTime' | 'paidAt'>
>;

/** Teto de linhas por listagem: a API devolve as mais recentes e nunca uma resposta sem limite. */
export const FINANCE_LIST_LIMIT = 2000;

export interface FinanceEntryRepository {
  /** Lança `ConflictError('lancamento_ja_cadastrado')` se `entry.id` já existe. */
  create(userId: string, entry: NewFinanceEntry): Promise<FinanceEntryDto>;
  get(userId: string, id: string): Promise<FinanceEntryDto | null>;
  /**
   * Filtros: `from`/`to` (inclusivos, sobre `dueDate`) e `status`. Ordem: `dueDate` desc, depois
   * `createdAt` desc; no máximo `FINANCE_LIST_LIMIT` linhas (as mais recentes).
   */
  list(userId: string, query: ListFinanceEntriesQuery): Promise<FinanceEntryDto[]>;
  /** `null` se o id não existe para o usuário; senão o lançamento atualizado. */
  update(userId: string, id: string, patch: FinanceEntryPatch): Promise<FinanceEntryDto | null>;
  /** `true` somente se um lançamento do usuário foi apagado. */
  remove(userId: string, id: string): Promise<boolean>;
}
