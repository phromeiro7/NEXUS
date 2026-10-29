import type {
  CaseDto,
  CreateCaseInput,
  CreateHolidayInput,
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

export type ChatChannel = 'painel' | 'telegram';
export type ChatRole = 'user' | 'assistant';

export interface ChatRepository {
  /** Guarda a mensagem com `created_at = now` e validade de 24 h a partir de `now`. */
  append(userId: string, channel: ChatChannel, role: ChatRole, content: string, now: Date): Promise<void>;
  /** Até `limit` mensagens não expiradas (`expires_at > now`) do usuário no canal, em ordem cronológica. */
  recent(
    userId: string,
    channel: ChatChannel,
    limit: number,
    now: Date,
  ): Promise<Array<{ role: ChatRole; content: string }>>;
}

export type InboundEventStatus = 'recebido' | 'processando' | 'processado' | 'falhou';

export interface InboundEventRepository {
  /**
   * Registro atômico (único `(channel, externalId)`). `firstTime: true` para evento novo ou
   * `falhou` (reiniciado como `recebido`); `false` para qualquer outro estado, com o `reply`
   * guardado. Lança `ForeignEventError` se o evento pertence a outro usuário. `userId` nulo
   * (Telegram sem vínculo) é adotado pelo primeiro usuário que o registrar.
   */
  register(
    userId: string | null,
    channel: ChatChannel,
    externalId: string,
    now: Date,
  ): Promise<{ firstTime: boolean; status: InboundEventStatus; reply: unknown | null }>;
  /*
   * As três transições abaixo filtram pelo dono do evento (`userId`; `null` = evento sem
   * vínculo) e por pré-condição de estado, de forma atômica. Erros tipados, nunca sucesso
   * silencioso: `ForeignEventError` (evento de outro usuário), `EventStateError` (evento
   * inexistente ou estado que não permite a transição).
   */
  /**
   * 'recebido' -> 'processando', `attempt_count + 1` e registra UMA chamada ao modelo (conta no
   * limite horário). `userId` obrigatório (não nulo).
   */
  beginModelCall(userId: string, channel: ChatChannel, externalId: string, now: Date): Promise<void>;
  /** 'processando' -> 'processado', `processed_at = now`, guarda `reply` (jsonb, < 64 KB). */
  markProcessed(
    userId: string | null,
    channel: ChatChannel,
    externalId: string,
    reply: unknown,
    now: Date,
  ): Promise<void>;
  /** 'recebido' ou 'processando' -> 'falhou' (pode ser reprocessado por `register`). Nunca reabre 'processado'. */
  markFailed(userId: string | null, channel: ChatChannel, externalId: string, now: Date): Promise<void>;
  /**
   * Número de CHAMADAS AO MODELO do usuário no canal com `called_at >= since` (Ruling 9: conta
   * chamadas, não eventos; reenvio ou recusa sem chamada não contam).
   */
  countSince(userId: string, channel: ChatChannel, since: Date): Promise<number>;
}

/*
 * Modelo de IA. `ModelMessage` é o histórico do ciclo de ferramentas: texto simples, ou blocos.
 * O assistente responde com `text` e `tool_use`; o servidor devolve cada resultado como um
 * bloco `tool_result` (mensagem `user`) cujo `tool_use_id` é o `id` do `tool_use` respondido.
 *
 * Blocos `thinking`/`redacted_thinking` (Haiku 5.5 pensa por padrão): o adaptador deve produzi-los
 * VERBATIM a partir da resposta da API em `raw` (mesmo com texto vazio) e o ciclo deve reenviá-los
 * sem modificação, na mesma ordem, antes dos blocos `tool_use` da mensagem do assistente.
 */
export type ThinkingPassThrough = { type: 'thinking' | 'redacted_thinking'; raw: unknown };

export type ContentBlock =
  | ThinkingPassThrough
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export type ModelMessage = { role: 'user' | 'assistant'; content: string | Array<ContentBlock> };

/** Trecho do prompt de sistema; `cache: true` marca o fim do trecho cacheável. */
export type SystemBlock = { type: 'text'; text: string; cache?: boolean };

export type ToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema do input da ferramenta. */
  inputSchema: Record<string, unknown>;
};

export type ModelStep = {
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';
  blocks: Array<
    ThinkingPassThrough | { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }
  >;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
};

export interface AssistantModel {
  step(input: {
    system: SystemBlock[];
    messages: ModelMessage[];
    tools: ToolDefinition[];
    signal: AbortSignal;
  }): Promise<ModelStep>;
}
