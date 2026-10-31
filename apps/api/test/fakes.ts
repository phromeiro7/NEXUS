import type { CaseDto, HolidayDto, IsoDate, SettingsDto, TaskDto } from '@aj/shared';
import {
  ConflictError,
  EventStateError,
  ForeignEventError,
  LinkCodeCollisionError,
  ReminderLeaseError,
} from '../src/application/errors.js';
import { briefingLocalDate } from '../src/domain/briefing-window.js';
import type {
  BriefingRepository,
  CaseRepository,
  ChatChannel,
  ChatRepository,
  ChatRole,
  ClaimedReminder,
  Clock,
  ConfirmationRepository,
  LinkCodeRepository,
  MaintenanceRepository,
  ReminderQueue,
  TelegramClient,
  InboundEventRepository,
  InboundEventStatus,
  HolidayAdminRepository,
  HolidayRepository,
  NewTask,
  ProfileRepository,
  ReminderRepository,
  TaskPatch,
  TaskRepository,
} from '../src/application/ports.js';
import type { TelegramErrorClass } from '../src/domain/reminder-message.js';
import type { ReminderDraft, ReminderKind } from '../src/domain/reminders.js';

type TaskRow = { userId: string; dto: TaskDto; deletedAt: Date | null };

const DEFAULT_PROFILE: SettingsDto = {
  timezone: 'America/Sao_Paulo',
  uf: null,
  city: null,
  earlyReminderMinutes: 15,
  briefingTime: '08:00',
  telegramLinked: false,
  channelPaused: false,
};

function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Nulos por último. */
function cmp<T extends string>(a: T | null, b: T | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

export function createFakes(seed: { now?: Date } = {}) {
  let now = seed.now ?? new Date('2026-10-26T12:00:00Z');
  const clock: Clock = { now: () => new Date(now) };
  const stamp = () => now.toISOString();

  const taskRows: TaskRow[] = [];
  const caseRows: { userId: string; dto: CaseDto }[] = [];
  const holidayRows: { userId: string; dto: HolidayDto }[] = [];
  const profileRows = new Map<string, SettingsDto>();

  const tasks: TaskRepository = {
    async create(userId, task: NewTask) {
      const { source: _source, sourceText: _sourceText, ...fields } = task;
      const dto: TaskDto = { ...fields, id: crypto.randomUUID(), createdAt: stamp(), updatedAt: stamp() };
      taskRows.push({ userId, dto, deletedAt: null });
      return { ...dto };
    },
    async get(userId, id) {
      const row = taskRows.find((r) => r.userId === userId && r.dto.id === id && r.deletedAt === null);
      return row ? { ...row.dto } : null;
    },
    async list(userId, query) {
      const statuses = query.status && query.status.length > 0 ? query.status : null;
      return taskRows
        .filter((r) => r.userId === userId && r.deletedAt === null)
        .map((r) => r.dto)
        .filter((t) => {
          if (statuses && !statuses.includes(t.status)) return false;
          if (query.caseId !== undefined && t.caseId !== query.caseId) return false;
          if (query.withoutDate === true && t.dueDate !== null) return false;
          if (query.from !== undefined && (t.dueDate === null || t.dueDate < query.from)) return false;
          if (query.to !== undefined && (t.dueDate === null || t.dueDate > query.to)) return false;
          return true;
        })
        .sort((a, b) => cmp(a.dueDate, b.dueDate) || cmp(a.dueTime, b.dueTime) || cmp(a.createdAt, b.createdAt))
        .map((t) => ({ ...t }));
    },
    async update(userId, id, patch: TaskPatch) {
      const row = taskRows.find((r) => r.userId === userId && r.dto.id === id && r.deletedAt === null);
      if (!row) return null;
      row.dto = { ...row.dto, ...defined(patch), updatedAt: stamp() };
      return { ...row.dto };
    },
    async softDelete(userId, id, at) {
      const row = taskRows.find((r) => r.userId === userId && r.dto.id === id && r.deletedAt === null);
      if (!row) return false;
      row.deletedAt = at;
      return true;
    },
  };

  const numberTaken = (userId: string, number: string, exceptId?: string) =>
    caseRows.some((r) => r.userId === userId && r.dto.number === number && r.dto.id !== exceptId);

  const cases: CaseRepository = {
    async create(userId, input) {
      if (numberTaken(userId, input.number)) throw new ConflictError('numero_ja_cadastrado');
      const dto: CaseDto = {
        id: crypto.randomUUID(),
        number: input.number,
        clientName: input.clientName ?? null,
        description: input.description ?? null,
        status: 'ativo',
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      caseRows.push({ userId, dto });
      return { ...dto };
    },
    async get(userId, id) {
      const row = caseRows.find((r) => r.userId === userId && r.dto.id === id);
      return row ? { ...row.dto } : null;
    },
    async list(userId, filter) {
      return caseRows
        .filter((r) => r.userId === userId && (filter.status === undefined || r.dto.status === filter.status))
        .map((r) => ({ ...r.dto }));
    },
    async update(userId, id, patch) {
      const row = caseRows.find((r) => r.userId === userId && r.dto.id === id);
      if (!row) return null;
      if (patch.number !== undefined && numberTaken(userId, patch.number, id)) {
        throw new ConflictError('numero_ja_cadastrado');
      }
      row.dto = { ...row.dto, ...defined(patch), updatedAt: stamp() };
      return { ...row.dto };
    },
  };

  const holidays: HolidayRepository & HolidayAdminRepository = {
    async listByUser(userId, from: IsoDate, to: IsoDate) {
      return holidayRows
        .filter((r) => r.userId === userId && r.dto.date >= from && r.dto.date <= to)
        .map((r) => ({ date: r.dto.date, name: r.dto.name }));
    },
    async list(userId) {
      return holidayRows
        .filter((r) => r.userId === userId)
        .map((r) => ({ ...r.dto }))
        .sort((a, b) => cmp(a.date, b.date));
    },
    async create(userId, input) {
      if (holidayRows.some((r) => r.userId === userId && r.dto.date === input.date)) {
        throw new ConflictError('feriado_ja_cadastrado');
      }
      const dto: HolidayDto = { id: crypto.randomUUID(), date: input.date, scope: input.scope, name: input.name };
      holidayRows.push({ userId, dto });
      return { ...dto };
    },
    async remove(userId, id) {
      const i = holidayRows.findIndex((r) => r.userId === userId && r.dto.id === id);
      if (i < 0) return false;
      holidayRows.splice(i, 1);
      return true;
    },
  };

  const profileOf = (userId: string): SettingsDto => {
    let p = profileRows.get(userId);
    if (!p) {
      p = { ...DEFAULT_PROFILE };
      profileRows.set(userId, p);
    }
    return p;
  };

  const profiles: ProfileRepository = {
    async get(userId) {
      return { ...profileOf(userId), channelPaused: pausedUsers.has(userId) };
    },
    async update(userId, patch) {
      const next = { ...profileOf(userId), ...defined(patch) };
      profileRows.set(userId, next);
      return { ...next, channelPaused: pausedUsers.has(userId) };
    },
  };

  const calls: { userId: string; taskId: string; drafts: ReminderDraft[] }[] = [];
  const current = new Map<string, ReminderDraft[]>();
  let failNext = false;
  const key = (userId: string, taskId: string) => `${userId}\u0000${taskId}`;
  const reminders: ReminderRepository & {
    calls: typeof calls;
    /** Rascunhos atuais da tarefa; sem `userId`, procura em qualquer usuário. */
    remindersFor(taskId: string, userId?: string): ReminderDraft[];
    failNextReplace(): void;
  } = {
    calls,
    async replacePending(userId, taskId, drafts) {
      calls.push({ userId, taskId, drafts });
      if (failNext) {
        failNext = false;
        throw new Error('replace failed');
      }
      current.set(key(userId, taskId), drafts.map((d) => ({ ...d })));
    },
    remindersFor(taskId, userId) {
      for (const [k, v] of current) {
        const [u, t] = k.split('\u0000');
        if (t === taskId && (userId === undefined || u === userId)) return v;
      }
      return [];
    },
    failNextReplace() {
      failNext = true;
    },
  };

  const DAY_MS = 24 * 60 * 60 * 1000;
  const chatRows: { userId: string; channel: ChatChannel; role: ChatRole; content: string; createdAt: Date; expiresAt: Date }[] = [];
  const chat: ChatRepository = {
    async append(userId, channel, role, content, at) {
      chatRows.push({ userId, channel, role, content, createdAt: at, expiresAt: new Date(at.getTime() + DAY_MS) });
    },
    async recent(userId, channel, limit, at) {
      // Ordenação estável: empates de `createdAt` mantêm a ordem de inserção.
      return chatRows
        .filter((r) => r.userId === userId && r.channel === channel && r.expiresAt > at)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(-limit)
        .map(({ role, content }) => ({ role, content }));
    },
  };

  type EventRow = {
    userId: string | null;
    channel: ChatChannel;
    externalId: string;
    status: InboundEventStatus;
    receivedAt: Date;
    attemptCount: number;
    reply: unknown | null;
  };
  const eventRows: EventRow[] = [];
  const modelCalls: { userId: string; channel: ChatChannel; calledAt: Date }[] = [];
  /** Mesma ordem de verificações do SQL: inexistente, outro usuário, estado inválido. */
  const ownedEvent = (
    userId: string | null,
    channel: ChatChannel,
    externalId: string,
    allowed: InboundEventStatus[],
  ): EventRow => {
    const row = eventRows.find((r) => r.channel === channel && r.externalId === externalId);
    if (!row) throw new EventStateError('evento_inexistente');
    if (row.userId !== userId) throw new ForeignEventError();
    if (!allowed.includes(row.status)) throw new EventStateError('evento_em_estado_invalido');
    return row;
  };
  const inboundEvents: InboundEventRepository = {
    async register(userId, channel, externalId, at) {
      const row = eventRows.find((r) => r.channel === channel && r.externalId === externalId);
      if (!row) {
        eventRows.push({ userId, channel, externalId, status: 'recebido', receivedAt: at, attemptCount: 0, reply: null });
        return { firstTime: true, status: 'recebido', reply: null };
      }
      if (row.userId !== null && row.userId !== userId) throw new ForeignEventError();
      if (row.userId === null && userId !== null) row.userId = userId;
      if (row.status === 'falhou') {
        row.status = 'recebido';
        row.receivedAt = at;
        return { firstTime: true, status: 'recebido', reply: null };
      }
      return { firstTime: false, status: row.status, reply: structuredClone(row.reply) };
    },
    async beginModelCall(userId, channel, externalId, at) {
      if (userId === null || userId === undefined) throw new EventStateError('usuario_obrigatorio');
      const row = ownedEvent(userId, channel, externalId, ['recebido']);
      row.status = 'processando';
      row.attemptCount += 1;
      modelCalls.push({ userId, channel, calledAt: at });
    },
    async markProcessed(userId, channel, externalId, reply) {
      const row = ownedEvent(userId, channel, externalId, ['processando']);
      row.status = 'processado';
      row.reply = structuredClone(reply);
    },
    async markFailed(userId, channel, externalId) {
      ownedEvent(userId, channel, externalId, ['recebido', 'processando']).status = 'falhou';
    },
    async countSince(userId, since) {
      return modelCalls.filter((c) => c.userId === userId && c.calledAt >= since).length;
    },
  };

  // ---- Telegram: cliente falso com respostas roteirizadas ----
  type SendResult = Awaited<ReturnType<TelegramClient['sendMessage']>>;
  const sent: Array<{ chatId: number; text: string }> = [];
  const scripted: SendResult[] = [];
  let nextMessageId = 1000;
  const telegram: TelegramClient & {
    sent: typeof sent;
    /** Próximas respostas, em ordem; esgotadas, devolve sucesso com `messageId` crescente. */
    script(...results: SendResult[]): void;
    failNext(error: TelegramErrorClass): void;
  } = {
    sent,
    async sendMessage(chatId, text) {
      sent.push({ chatId, text });
      return scripted.shift() ?? { ok: true, messageId: nextMessageId++ };
    },
    script(...results) {
      scripted.push(...results);
    },
    failNext(error) {
      scripted.push({ ok: false, error });
    },
  };

  // ---- Vínculo do Telegram (profiles.telegram_chat_id / channel_paused / link_codes) ----
  const chatOf = new Map<string, number>();
  const pausedUsers = new Set<string>();
  const linkRows: { code: string; userId: string; expiresAt: Date }[] = [];
  const ownerOfChat = (chatId: number, except?: string): string | null => {
    for (const [u, c] of chatOf) if (c === chatId && u !== except) return u;
    return null;
  };
  const links: LinkCodeRepository & {
    /** Prepara o estado: vincula o chat sem passar por código. */
    setChat(userId: string, chatId: number | null): void;
    chatFor(userId: string): number | null;
    isPaused(userId: string): boolean;
    codesOf(userId: string): string[];
  } = {
    async create(userId, code, expiresAt) {
      for (let i = linkRows.length - 1; i >= 0; i--) if (linkRows[i]!.userId === userId) linkRows.splice(i, 1);
      if (linkRows.some((r) => r.code === code)) throw new LinkCodeCollisionError();
      linkRows.push({ code, userId, expiresAt });
    },
    async consume(code, chatId, at) {
      const i = linkRows.findIndex((r) => r.code === code && r.expiresAt > at);
      if (i < 0) return { status: 'invalido' };
      const userId = linkRows[i]!.userId;
      if (ownerOfChat(chatId, userId) !== null) return { status: 'chat_em_uso' };
      chatOf.set(userId, chatId);
      profileRows.set(userId, { ...profileOf(userId), telegramLinked: true });
      pausedUsers.delete(userId);
      linkRows.splice(i, 1);
      return { status: 'ok', userId };
    },
    async unlink(userId) {
      chatOf.delete(userId);
      profileRows.set(userId, { ...profileOf(userId), telegramLinked: false });
    },
    async userForChat(chatId) {
      return ownerOfChat(chatId);
    },
    setChat(userId, chatId) {
      if (chatId === null) chatOf.delete(userId);
      else chatOf.set(userId, chatId);
      profileRows.set(userId, { ...profileOf(userId), telegramLinked: chatId !== null });
    },
    chatFor: (userId) => chatOf.get(userId) ?? null,
    isPaused: (userId) => pausedUsers.has(userId),
    codesOf: (userId) => linkRows.filter((r) => r.userId === userId).map((r) => r.code),
  };

  // ---- Briefing diário: mesma semântica de claim_briefing / release_briefing ----
  const lastBriefing = new Map<string, IsoDate>();
  const skippedUsers: string[] = [];
  const previousDay = (d: IsoDate): IsoDate => {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, day - 1)).toISOString().slice(0, 10) as IsoDate;
  };
  const briefings: BriefingRepository & {
    /** Prepara o estado: `last_briefing_sent_on`. */
    seedLastSent(userId: string, date: IsoDate | null): void;
    lastSent(userId: string): IsoDate | null;
    /** Usuários pulados por perfil inválido (fuso/hora), em ordem. */
    skipped(): string[];
  } = {
    skipped: () => [...skippedUsers],
    async dueFor(at) {
      const out: Array<{ userId: string; chatId: number; timezone: string; localDate: IsoDate }> = [];
      for (const [userId, chatId] of chatOf) {
        if (pausedUsers.has(userId)) continue;
        const p = profileOf(userId);
        let localDate: IsoDate | null;
        try {
          localDate = briefingLocalDate(at, p.timezone, p.briefingTime);
        } catch {
          skippedUsers.push(userId);
          continue;
        }
        if (localDate === null) continue;
        const last = lastBriefing.get(userId) ?? null;
        if (last !== null && last >= localDate) continue;
        out.push({ userId, chatId, timezone: p.timezone, localDate });
      }
      return out;
    },
    // Síncrono dentro do método: atômico como o UPDATE condicional do SQL.
    async claim(userId, localDate) {
      const last = lastBriefing.get(userId) ?? null;
      if (last !== null && last >= localDate) return false;
      lastBriefing.set(userId, localDate);
      return true;
    },
    async release(userId, localDate) {
      if (lastBriefing.get(userId) === localDate) lastBriefing.set(userId, previousDay(localDate));
    },
    seedLastSent(userId, date) {
      if (date === null) lastBriefing.delete(userId);
      else lastBriefing.set(userId, date);
    },
    lastSent: (userId) => lastBriefing.get(userId) ?? null,
  };

  // ---- Fila de lembretes: mesma semântica das funções SQL (reserva, cerca, recuperação) ----
  type ReminderStatus = 'pendente' | 'enviando' | 'enviado' | 'falhou' | 'cancelado';
  type ReminderRow = {
    id: string;
    userId: string;
    taskId: string;
    kind: ReminderKind;
    scheduledAt: Date;
    status: ReminderStatus;
    attempts: number;
    lockedAt: Date | null;
    nextAttemptAt: Date | null;
    sentAt: Date | null;
    lastError: string | null;
  };
  const queueRows: ReminderRow[] = [];
  const HOUR_MS = 60 * 60 * 1000;
  const taskOpen = (userId: string, taskId: string): boolean => {
    const t = taskRows.find((r) => r.userId === userId && r.dto.id === taskId);
    return t !== undefined && t.deletedAt === null && (t.dto.status === 'pendente' || t.dto.status === 'em_andamento');
  };
  const dueAt = (r: ReminderRow): Date => r.nextAttemptAt ?? r.scheduledAt;
  const reminderQueue: ReminderQueue & {
    /** Prepara o estado: insere um lembrete de uma tarefa já criada em `tasks`. */
    seed(input: {
      userId: string;
      taskId: string;
      kind?: ReminderKind;
      scheduledAt: Date;
      status?: ReminderStatus;
      attempts?: number;
      lockedAt?: Date | null;
      nextAttemptAt?: Date | null;
    }): string;
    row(id: string): Readonly<ReminderRow> | undefined;
  } = {
    seed(input) {
      const id = crypto.randomUUID();
      queueRows.push({
        id,
        userId: input.userId,
        taskId: input.taskId,
        kind: input.kind ?? 'no_horario',
        scheduledAt: input.scheduledAt,
        status: input.status ?? 'pendente',
        attempts: input.attempts ?? 0,
        lockedAt: input.lockedAt ?? null,
        nextAttemptAt: input.nextAttemptAt ?? null,
        sentAt: null,
        lastError: null,
      });
      return id;
    },
    row: (id) => queueRows.find((r) => r.id === id),
    async claimDue(at, limit) {
      const picked = queueRows
        .filter(
          (r) =>
            r.status === 'pendente' &&
            dueAt(r) <= at &&
            r.scheduledAt.getTime() >= at.getTime() - 24 * HOUR_MS &&
            taskOpen(r.userId, r.taskId) &&
            chatOf.has(r.userId) &&
            !pausedUsers.has(r.userId),
        )
        .sort((a, b) => dueAt(a).getTime() - dueAt(b).getTime() || (a.id < b.id ? -1 : 1))
        .slice(0, Math.max(limit, 0));
      return picked.map((r): ClaimedReminder => {
        r.status = 'enviando';
        r.lockedAt = at;
        r.attempts += 1;
        const task = taskRows.find((t) => t.userId === r.userId && t.dto.id === r.taskId)!.dto;
        return {
          reminderId: r.id,
          userId: r.userId,
          taskId: r.taskId,
          kind: r.kind,
          scheduledAt: new Date(r.scheduledAt),
          attempts: r.attempts,
          title: task.title,
          taskType: task.type,
          dueDate: task.dueDate as IsoDate,
          dueTime: task.dueTime,
          fatal: task.fatal,
          chatId: chatOf.get(r.userId)!,
          timezone: profileOf(r.userId).timezone,
        };
      });
    },
    async cancelDead(at) {
      let n = 0;
      for (const r of queueRows) {
        if (r.status !== 'pendente') continue;
        const open = taskOpen(r.userId, r.taskId);
        if (r.scheduledAt.getTime() < at.getTime() - 24 * HOUR_MS || !open) {
          r.status = 'cancelado';
          r.lockedAt = null;
          r.lastError = open ? 'atrasado_demais' : 'tarefa_encerrada';
          n += 1;
        }
      }
      return n;
    },
    async recoverStuck(at) {
      let n = 0;
      for (const r of queueRows) {
        if (r.status === 'enviando' && r.lockedAt !== null && r.lockedAt.getTime() < at.getTime() - 5 * 60_000) {
          r.status = 'pendente';
          r.lockedAt = null;
          n += 1;
        }
      }
      return n;
    },
    async finish(input, at) {
      // Mesma ordem do SQL: status, próxima tentativa, existência, estado, cerca de reserva.
      if (!['enviado', 'pendente', 'falhou', 'cancelado'].includes(input.status)) throw new Error('status_invalido');
      if (input.status === 'pendente' && input.nextAttemptAt === null) {
        throw new Error('lembrete_sem_proxima_tentativa');
      }
      const r = queueRows.find((x) => x.id === input.reminderId);
      if (!r) throw new ReminderLeaseError('lembrete_inexistente');
      if (r.status !== 'enviando') throw new ReminderLeaseError('lembrete_em_estado_invalido');
      if (r.attempts !== input.attempts) throw new ReminderLeaseError('lembrete_reservado_por_outro');
      r.status = input.status;
      if (input.status === 'enviado') r.sentAt = at;
      r.nextAttemptAt = input.status === 'pendente' ? input.nextAttemptAt : null;
      r.lastError = input.error === null ? null : input.error.slice(0, 200);
      r.lockedAt = null;
    },
    async pauseChannel(userId) {
      pausedUsers.add(userId);
    },
  };

  // ---- Confirmações (task_confirmations) ----
  const confirmationRows: { chatId: number; messageId: number; taskId: string }[] = [];
  const confirmations: ConfirmationRepository = {
    async record(chatId, messageId, taskIds) {
      for (const taskId of taskIds) {
        if (!taskRows.some((t) => t.dto.id === taskId)) throw new Error('tarefa inexistente (chave estrangeira)');
        const exists = confirmationRows.some(
          (r) => r.chatId === chatId && r.messageId === messageId && r.taskId === taskId,
        );
        if (!exists) confirmationRows.push({ chatId, messageId, taskId });
      }
    },
    async tasksFor(userId, chatId, messageId) {
      const alive: string[] = [];
      let deletedCount = 0;
      for (const c of confirmationRows) {
        if (c.chatId !== chatId || c.messageId !== messageId) continue;
        const t = taskRows.find((r) => r.dto.id === c.taskId && r.userId === userId);
        if (!t) continue;
        if (t.deletedAt === null) alive.push(t.dto.id);
        else deletedCount += 1;
      }
      return { alive: alive.sort(), deletedCount };
    },
  };

  // ---- Manutenção ----
  const maintenance: MaintenanceRepository = {
    async purgeExpiredChatMessages(at) {
      let n = 0;
      for (let i = chatRows.length - 1; i >= 0; i--) {
        if (chatRows[i]!.expiresAt < at) {
          chatRows.splice(i, 1);
          n += 1;
        }
      }
      return n;
    },
    async purgeExpiredLinkCodes(at) {
      let n = 0;
      for (let i = linkRows.length - 1; i >= 0; i--) {
        if (linkRows[i]!.expiresAt < at) {
          linkRows.splice(i, 1);
          n += 1;
        }
      }
      return n;
    },
    async purgeOldModelCalls(at) {
      let n = 0;
      for (let i = modelCalls.length - 1; i >= 0; i--) {
        if (modelCalls[i]!.calledAt.getTime() < at.getTime() - 48 * HOUR_MS) {
          modelCalls.splice(i, 1);
          n += 1;
        }
      }
      return n;
    },
    async recoverStuckEvents(at) {
      let recovered = 0;
      let failed = 0;
      for (const e of eventRows) {
        if ((e.status === 'recebido' || e.status === 'processando') && e.receivedAt.getTime() < at.getTime() - 2 * 60_000) {
          if (e.attemptCount >= 1) {
            e.status = 'processado';
            e.reply = {
              reply:
                'Sua mensagem pode ter sido processada só em parte. Confira suas tarefas e envie de novo o que faltar.',
              affectedTasks: [],
            };
            recovered += 1;
          } else {
            e.status = 'falhou';
            failed += 1;
          }
        }
      }
      return { recovered, failed };
    },
  };

  return {
    telegram,
    links,
    briefings,
    reminderQueue,
    confirmations,
    maintenance,
    tasks,
    cases,
    profiles,
    holidays,
    reminders,
    chat,
    inboundEvents,
    clock,
    setNow(date: Date) {
      now = date;
    },
    setProfile(userId: string, patch: Partial<SettingsDto>) {
      profileRows.set(userId, { ...profileOf(userId), ...patch });
      if (patch.channelPaused !== undefined) {
        if (patch.channelPaused) pausedUsers.add(userId);
        else pausedUsers.delete(userId);
      }
    },
  };
}

export type Fakes = ReturnType<typeof createFakes>;
