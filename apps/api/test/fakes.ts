import type { CaseDto, HolidayDto, IsoDate, SettingsDto, TaskDto } from '@aj/shared';
import { ConflictError, EventStateError, ForeignEventError } from '../src/application/errors.js';
import type {
  CaseRepository,
  ChatChannel,
  ChatRepository,
  ChatRole,
  Clock,
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
import type { ReminderDraft } from '../src/domain/reminders.js';

type TaskRow = { userId: string; dto: TaskDto; deletedAt: Date | null };

const DEFAULT_PROFILE: SettingsDto = {
  timezone: 'America/Sao_Paulo',
  uf: null,
  city: null,
  earlyReminderMinutes: 15,
  briefingTime: '08:00',
  telegramLinked: false,
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
      return { ...profileOf(userId) };
    },
    async update(userId, patch) {
      const next = { ...profileOf(userId), ...defined(patch) };
      profileRows.set(userId, next);
      return { ...next };
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
    async countSince(userId, channel, since) {
      return modelCalls.filter((c) => c.userId === userId && c.channel === channel && c.calledAt >= since).length;
    },
  };

  return {
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
    },
  };
}

export type Fakes = ReturnType<typeof createFakes>;
