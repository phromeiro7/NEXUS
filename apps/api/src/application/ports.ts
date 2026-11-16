import type {
  FinanceEntryDto,
  ListFinanceEntriesQuery,
  IsoDate,
  ListTasksQuery,
  SettingsDto,
  TaskDto,
  TaskType,
  UpdateSettingsInput,
} from '@nexus/shared';
import type { TelegramErrorClass } from '../domain/reminder-message.js';
import type { ReminderDraft, ReminderKind } from '../domain/reminders.js';

/*
 * Contrato comum a todas as portas: todo método recebe `userId` primeiro e NUNCA
 * devolve nem altera linhas de outro usuário.
 */

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
   * `withoutDate` (só `dueDate === null`). Ordem: `dueDate` asc (nulos por último),
   * `dueTime` (nulo por último), `createdAt`.
   */
  list(userId: string, query: ListTasksQuery): Promise<TaskDto[]>;
  /** `null` se o id não existe para o usuário (ou foi apagado); senão a tarefa atualizada. */
  update(userId: string, id: string, patch: TaskPatch): Promise<TaskDto | null>;
  /** `true` somente se uma tarefa viva do usuário foi apagada. */
  softDelete(userId: string, id: string, now: Date): Promise<boolean>;
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
   * Número de CHAMADAS AO MODELO do usuário, em TODOS os canais, com `called_at >= since` (Ruling 9:
   * conta chamadas, não eventos; reenvio ou recusa sem chamada não contam; o limite é por usuário).
   */
  countSince(userId: string, since: Date): Promise<number>;
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

/*
 * Telegram e lembretes (Plano 5).
 */

/** Botão em linha: devolve `callbackData` ao webhook (até 64 bytes), abre o Mini App (`webAppUrl`, https) ou abre um link (`url`, https). */
export type InlineButton = { text: string } & ({ callbackData: string } | { webAppUrl: string } | { url: string });
export type InlineKeyboard = InlineButton[][];

type TelegramCall<T> = Promise<({ ok: true } & T) | { ok: false; error: TelegramErrorClass }>;

/** Envia texto simples. Nunca lança por falha do Telegram: devolve a classificação do erro. */
export interface TelegramClient {
  sendMessage(
    chatId: number,
    text: string,
    options?: { keyboard?: InlineKeyboard },
  ): Promise<{ ok: true; messageId: number } | { ok: false; error: TelegramErrorClass }>;
  /** Troca o texto (e os botões; sem `keyboard` os botões somem) de uma mensagem já enviada. */
  editMessageText(chatId: number, messageId: number, text: string, options?: { keyboard?: InlineKeyboard }): TelegramCall<unknown>;
  /** Fecha o "carregando" do botão; `text` aparece como aviso curto para a pessoa. */
  answerCallbackQuery(callbackQueryId: string, text?: string): TelegramCall<unknown>;
}

/** Lembrete reservado (`enviando`) com tudo o que o envio precisa; `attempts` é o token de reserva. */
export type ClaimedReminder = {
  reminderId: string;
  userId: string;
  taskId: string;
  kind: ReminderKind;
  scheduledAt: Date;
  attempts: number;
  title: string;
  taskType: TaskType;
  dueDate: IsoDate;
  /** HH:mm */
  dueTime: string | null;
  fatal: boolean;
  chatId: number;
  timezone: string;
};

export interface ReminderQueue {
  /** Reserva até `limit` lembretes vencidos (SKIP LOCKED); o mais antigo primeiro. */
  claimDue(now: Date, limit: number): Promise<ClaimedReminder[]>;
  /** Cancela lembretes que nunca devem ser enviados (tarefa apagada/encerrada ou atraso > 24 h). */
  cancelDead(now: Date): Promise<number>;
  /** Devolve a `pendente` os lembretes presos em `enviando` há mais de 5 minutos. */
  recoverStuck(now: Date): Promise<number>;
  /**
   * Registra o resultado do envio. `attempts` é o valor devolvido por `claimDue` (cerca de reserva).
   * Lança `ReminderLeaseError` se a reserva foi perdida; qualquer outro erro do banco propaga.
   */
  finish(
    input: {
      reminderId: string;
      attempts: number;
      status: 'enviado' | 'pendente' | 'falhou' | 'cancelado';
      error: string | null;
      nextAttemptAt: Date | null;
    },
    now: Date,
  ): Promise<void>;
  /** Pausa o canal (`channel_paused`) só desse usuário. */
  pauseChannel(userId: string): Promise<void>;
}

export type BriefingRecipient = { userId: string; chatId: number; timezone: string; localDate: IsoDate };

export interface BriefingRepository {
  /**
   * Usuários vinculados e NÃO pausados cuja hora LOCAL (fuso do perfil) está em
   * [briefingTime, briefingTime + 4 h] e cujo último briefing é anterior a `localDate`
   * (Ruling 19). `localDate` é a data local do `briefingTime` (se a janela cruza a
   * meia-noite, a do dia anterior). Fora da janela nada é devolvido.
   */
  dueFor(now: Date): Promise<BriefingRecipient[]>;
  /** Atômico (`claim_briefing`): `true` só para quem tomou o dia. */
  claim(userId: string, localDate: IsoDate): Promise<boolean>;
  /** Desfaz o claim (`release_briefing`) só se o dia guardado é exatamente `localDate`. */
  release(userId: string, localDate: IsoDate): Promise<void>;
}

export interface LinkCodeRepository {
  /** Substitui TODOS os códigos anteriores do usuário por este. */
  create(userId: string, code: string, expiresAt: Date): Promise<void>;
  consume(
    code: string,
    chatId: number,
    now: Date,
  ): Promise<
    /** `accountHint`: e-mail MASCARADO da conta vinculada (`p***@dominio`), ou `null` se indisponível. */
    { status: 'ok'; userId: string; accountHint: string | null } | { status: 'invalido' } | { status: 'chat_em_uso' }
  >;
  /** Desvincula o Telegram do usuário (`telegram_chat_id` nulo). */
  unlink(userId: string): Promise<void>;
  /** Dono do chat, ou `null` se nenhum usuário o tem vinculado. */
  userForChat(chatId: number): Promise<string | null>;
}

export type CaptureStatus = 'pendente' | 'confirmando' | 'confirmada' | 'desfeita';
export type CaptureEntity = { kind: 'tarefa' | 'lancamento'; id: string };
export type CaptureRecord = {
  id: string;
  userId: string;
  chatId: number;
  /** A proposta (JSON); quem lê valida o formato. */
  payload: unknown;
  status: CaptureStatus;
  entity: CaptureEntity | null;
  messageId: number | null;
  expiresAt: Date;
};

/** Propostas do chat (chat_captures). Nada vai para tarefas nem lançamentos antes de `finishConfirm`. */
export interface CaptureRepository {
  /** Nova proposta `pendente`, válida por 1 h. */
  create(userId: string, chatId: number, payload: unknown, now: Date): Promise<CaptureRecord>;
  /** `null` se o id não existe, é inválido ou já expirou. */
  get(id: string, now: Date): Promise<CaptureRecord | null>;
  /** Troca a proposta só enquanto `pendente`; `false` se já não está. */
  updatePayload(id: string, payload: unknown): Promise<boolean>;
  setMessage(id: string, messageId: number): Promise<void>;
  /** `pendente` -> `confirmando`, atômico: só um toque ganha (`true`). */
  beginConfirm(id: string, now: Date): Promise<boolean>;
  /** `confirmando` -> `confirmada`, guarda o que foi criado e estende a validade para 24 h. */
  finishConfirm(id: string, entity: CaptureEntity, now: Date): Promise<void>;
  /** `confirmando` -> `pendente` (a criação falhou, a pessoa pode tentar de novo). */
  abortConfirm(id: string): Promise<void>;
  /** `confirmada` -> `desfeita`, atômico; devolve o que apagar, ou `null` se não estava confirmada. */
  beginUndo(id: string, now: Date): Promise<CaptureEntity | null>;
  /** `desfeita` -> `confirmada` (a exclusão falhou). */
  abortUndo(id: string): Promise<void>;
  /** Apaga as expiradas; devolve quantas. */
  purgeExpired(now: Date): Promise<number>;
}

export interface ConfirmationRepository {
  /** Idempotente (chave primária). */
  record(chatId: number, messageId: number, taskIds: string[]): Promise<void>;
  /** Tarefas da confirmação que são do usuário: vivas e a contagem das apagadas. Nunca vê tarefas de outro usuário. */
  tasksFor(userId: string, chatId: number, messageId: number): Promise<{ alive: string[]; deletedCount: number }>;
}

export interface MaintenanceRepository {
  purgeExpiredChatMessages(now: Date): Promise<number>;
  purgeExpiredLinkCodes(now: Date): Promise<number>;
  purgeOldModelCalls(now: Date): Promise<number>;
  recoverStuckEvents(now: Date): Promise<{ recovered: number; failed: number }>;
}

/** Guarda dos `initData` já usados: cada assinatura só abre uma sessão (anti-reuso). */
export interface TelegramAuthReplayRepository {
  /** Registra o hash; `false` se ele já tinha sido usado. Atômico: dois pedidos simultâneos, um só vence. */
  claim(hash: string, now: Date): Promise<boolean>;
  /** Apaga os registros que já não podem ser reaproveitados (a janela do `auth_date` passou); devolve quantos. */
  purgeExpired(now: Date): Promise<number>;
}

/** Emite o que o cliente troca por uma sessão da conta `userId`. Nunca envia e-mail. */
export interface SessionIssuer {
  /** `tokenHash` de uso único para `verifyOtp`, ou `null` se a conta não pode receber sessão (sem e-mail, etc.). */
  issue(userId: string): Promise<{ tokenHash: string } | null>;
}

/** Convite como guardado no banco; o estado (ativo, usado...) é calculado a partir destes campos. */
export type InviteRecord = {
  code: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  usedAt: Date | null;
  /** Conta criada com este convite (`null` enquanto não foi usado). */
  usedBy?: string | null;
  /** Nome dado pelo administrador (só para controle). */
  label?: string | null;
};

export interface InviteRepository {
  /** Lança `InviteCodeCollisionError` se o código já existe. */
  create(createdBy: string, code: string, createdAt: Date, expiresAt: Date, label?: string): Promise<void>;
  /** Os mais recentes primeiro. */
  list(limit: number): Promise<InviteRecord[]>;
  /** Revoga só um convite ainda não usado nem revogado; `false` = nada a revogar. */
  revoke(code: string, now: Date): Promise<boolean>;
  /** Um convite pelo código, ou `null`. */
  find(code: string): Promise<InviteRecord | null>;
  /** Apaga o convite (qualquer estado); `false` = não existia. */
  remove(code: string): Promise<boolean>;
  /** Reserva o código para UM chamador (atômico); `false` = inexistente, vencido, revogado ou já reservado. */
  claim(code: string, now: Date): Promise<boolean>;
  /** Marca o código reservado como usado pela conta criada. */
  finish(code: string, userId: string, now: Date): Promise<boolean>;
  /** Devolve um código reservado e não usado (a criação da conta falhou). */
  release(code: string): Promise<void>;
  /** Telegram (chat privado) vinculado à conta, ou `null`. */
  telegramIdOf(userId: string): Promise<number | null>;
}

/** Cria a conta de quem aceitou um convite e a liga ao Telegram. Sem e-mail real, sem senha. */
export interface AccountProvisioner {
  /** Conta nova (ou a conta anterior desse Telegram, se já existir) ligada ao `telegramUserId`. */
  createForTelegram(telegramUserId: number): Promise<{ userId: string; created: boolean }>;
  /** Liga o chat à conta; lança `ChatAlreadyLinkedError` se o chat já é de outra conta. */
  linkChat(userId: string, chatId: number): Promise<void>;
  /** Tira o acesso da conta na hora: bloqueia o login e desvincula o Telegram. Os dados ficam guardados. */
  block(userId: string): Promise<void>;
  /** Desfaz uma conta criada nesta tentativa (a ligação falhou). */
  remove(userId: string): Promise<void>;
}

/** Pedido de login do painel por QR code, como guardado (segredos só em hash). */
export type QrLoginRecord = {
  id: string;
  status: 'aguardando' | 'confirmar' | 'aprovado' | 'negado' | 'recusado' | 'consumido';
  /** SHA-256 (hex) do segredo de consulta do navegador. */
  pollHash: string;
  createdAt: Date;
  expiresAt: Date;
};

export interface QrLoginRepository {
  create(input: {
    id: string;
    nonceHash: string;
    pollHash: string;
    clientLabel: string;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<void>;
  get(id: string): Promise<QrLoginRecord | null>;
  /**
   * O bot recebeu `/start login_<nonce>`. Atômico: só vale com o pedido `aguardando` e não vencido (senão `null`).
   * Com conta (`userId`) o pedido vira `confirmar`; sem conta, `recusado`.
   */
  open(
    nonceHash: string,
    chatId: number,
    userId: string | null,
    now: Date,
  ): Promise<{ id: string; outcome: 'confirmar' | 'recusado'; clientLabel: string; createdAt: Date } | null>;
  /** A pessoa respondeu ao bot. Só o chat que abriu o pedido, para a conta perguntada, com o pedido em `confirmar`. */
  decide(id: string, chatId: number, userId: string, approve: boolean, now: Date): Promise<'aprovado' | 'negado' | null>;
  /** O navegador dono do segredo recolhe a aprovação: atômico, devolve o usuário uma única vez (`consumido`). */
  consume(id: string, pollHash: string, now: Date): Promise<string | null>;
  /** Devolve um pedido consumido a `aprovado` (a emissão da sessão falhou). */
  release(id: string): Promise<void>;
  /** Apaga os vencidos há mais de dez minutos; devolve quantos. */
  purgeExpired(now: Date): Promise<number>;
}
