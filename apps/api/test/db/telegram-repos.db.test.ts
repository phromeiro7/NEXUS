import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReminderLeaseError } from '../../src/application/errors.js';
import { createSupabaseConfirmationRepository } from '../../src/infra/supabase-confirmation-repository.js';
import { createSupabaseLinkRepository } from '../../src/infra/supabase-link-repository.js';
import { createSupabaseMaintenanceRepository } from '../../src/infra/supabase-maintenance-repository.js';
import { createSupabaseReminderQueue } from '../../src/infra/supabase-reminder-queue.js';
import { closePool, createUser, deleteCreatedUsers, pool } from './helpers.js';
import { getSupabaseEnv } from './supabase-env.js';

const env = getSupabaseEnv();
const admin: SupabaseClient = createClient(env.url, env.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const brokenClient = () =>
  createClient(env.url, 'not-a-valid-key', { auth: { persistSession: false, autoRefreshToken: false } });

const queue = createSupabaseReminderQueue(admin);
const links = createSupabaseLinkRepository(admin);
const confirmations = createSupabaseConfirmationRepository(admin);
const maintenance = createSupabaseMaintenanceRepository(admin);

// Relógio fixo no passado distante: nenhuma linha de desenvolvimento real é afetada pelas funções globais.
const NOW = new Date('2001-03-10T12:00:00.000Z');
const at = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000);

let chatSeq = 0;
const newChatId = (): number => 7_000_000_000 + Math.floor(Math.random() * 1_000_000_000) * 10 + (chatSeq++ % 10);

async function mkUser(opts: { chat?: number | null; paused?: boolean; timezone?: string } = {}) {
  const id = await createUser();
  const chat = opts.chat === undefined ? newChatId() : opts.chat;
  await pool.query(
    `update public.profiles set telegram_chat_id = $2, channel_paused = $3, timezone = $4 where id = $1`,
    [id, chat, opts.paused ?? false, opts.timezone ?? 'America/Sao_Paulo'],
  );
  return { id, chat };
}

async function mkTask(
  userId: string,
  o: { title?: string; type?: string; fatal?: boolean; dueTime?: string | null; deleted?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into public.tasks (id, user_id, title, type, status, fatal, due_date, due_time, deleted_at)
     values ($1, $2, $3, $4, 'pendente', $5, '2001-03-11', $6, $7)`,
    [
      id,
      userId,
      o.title ?? 'Tarefa',
      o.type ?? 'tarefa',
      o.fatal ?? false,
      o.dueTime === undefined ? '14:30' : o.dueTime,
      o.deleted ? NOW.toISOString() : null,
    ],
  );
  return id;
}

async function mkReminder(
  userId: string,
  taskId: string,
  o: { kind?: string; scheduledAt?: Date; status?: string; lockedAt?: Date | null; attempts?: number } = {},
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into public.reminders (id, user_id, task_id, kind, scheduled_at, status, locked_at, attempts)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      userId,
      taskId,
      o.kind ?? 'no_horario',
      (o.scheduledAt ?? at(-10)).toISOString(),
      o.status ?? 'pendente',
      o.lockedAt ? o.lockedAt.toISOString() : null,
      o.attempts ?? 0,
    ],
  );
  return id;
}

async function rem(id: string) {
  const { rows } = await pool.query(
    `select status, attempts, last_error, sent_at, locked_at, next_attempt_at from public.reminders where id = $1`,
    [id],
  );
  return rows[0] as {
    status: string;
    attempts: number;
    last_error: string | null;
    sent_at: Date | null;
    locked_at: Date | null;
    next_attempt_at: Date | null;
  };
}

async function profile(id: string) {
  const { rows } = await pool.query(`select telegram_chat_id, channel_paused from public.profiles where id = $1`, [id]);
  return rows[0] as { telegram_chat_id: string | null; channel_paused: boolean };
}

beforeAll(async () => {
  // Limpa resíduos globais para que as contagens abaixo sejam exatas.
  await queue.cancelDead(NOW);
  await queue.recoverStuck(NOW);
});

afterAll(async () => {
  await deleteCreatedUsers();
  await closePool();
}, 60_000);

describe('ReminderQueue.claimDue', () => {
  it('maps every column, including dueTime HH:mm and the chat/timezone of the profile', async () => {
    const u = await mkUser({ timezone: 'America/Manaus' });
    const task = await mkTask(u.id, { title: 'Contestação', type: 'prazo', fatal: true, dueTime: '14:30' });
    const id = await mkReminder(u.id, task, { kind: 'dia_anterior', scheduledAt: at(-10) });
    const claimed = (await queue.claimDue(NOW, 1000)).filter((c) => c.reminderId === id);
    expect(claimed).toEqual([
      {
        reminderId: id,
        userId: u.id,
        taskId: task,
        kind: 'dia_anterior',
        scheduledAt: at(-10),
        attempts: 1,
        title: 'Contestação',
        taskType: 'prazo',
        dueDate: '2001-03-11',
        dueTime: '14:30',
        fatal: true,
        chatId: u.chat,
        timezone: 'America/Manaus',
      },
    ]);
    expect(claimed[0]!.scheduledAt).toBeInstanceOf(Date);
    expect(typeof claimed[0]!.chatId).toBe('number');
    expect((await rem(id)).status).toBe('enviando');
  });

  it('maps a task without time to dueTime null', async () => {
    const u = await mkUser();
    const task = await mkTask(u.id, { dueTime: null });
    const id = await mkReminder(u.id, task);
    const [c] = (await queue.claimDue(NOW, 1000)).filter((x) => x.reminderId === id);
    expect(c?.dueTime).toBeNull();
  });

  it('honors the limit, oldest first, and does not reserve a paused or unlinked user', async () => {
    const u = await mkUser();
    const paused = await mkUser({ paused: true });
    const unlinked = await mkUser({ chat: null });
    const t1 = await mkTask(u.id);
    const t2 = await mkTask(u.id);
    const old = await mkReminder(u.id, t1, { scheduledAt: at(-30) });
    const recent = await mkReminder(u.id, t2, { scheduledAt: at(-5) });
    const rp = await mkReminder(paused.id, await mkTask(paused.id));
    const ru = await mkReminder(unlinked.id, await mkTask(unlinked.id));
    const mine = [old, recent, rp, ru];
    // Sem outros dados vencidos no relógio de 2001, o limite 1 devolve exatamente o mais antigo.
    const first = await queue.claimDue(NOW, 1);
    expect(first.map((c) => c.reminderId)).toEqual([old]);
    const rest = (await queue.claimDue(NOW, 1000)).map((c) => c.reminderId);
    expect(rest.filter((id) => mine.includes(id))).toEqual([recent]);
    expect((await rem(rp)).status).toBe('pendente');
    expect((await rem(ru)).status).toBe('pendente');
    expect(await queue.claimDue(NOW, 0)).toEqual([]);
  });
});

describe('ReminderQueue.cancelDead / recoverStuck', () => {
  it('cancelDead returns the count of cancelled reminders', async () => {
    const u = await mkUser();
    const dead = await mkReminder(u.id, await mkTask(u.id, { deleted: true }));
    const late = await mkReminder(u.id, await mkTask(u.id), { scheduledAt: at(-24 * 60 - 1) });
    const fine = await mkReminder(u.id, await mkTask(u.id));
    expect(await queue.cancelDead(NOW)).toBe(2);
    expect((await rem(dead)).status).toBe('cancelado');
    expect((await rem(late)).last_error).toBe('atrasado_demais');
    expect((await rem(fine)).status).toBe('pendente');
    expect(await queue.cancelDead(NOW)).toBe(0);
  });

  it('recoverStuck returns the count and keeps attempts', async () => {
    const u = await mkUser();
    const stuck = await mkReminder(u.id, await mkTask(u.id), { status: 'enviando', lockedAt: at(-6), attempts: 2 });
    const fresh = await mkReminder(u.id, await mkTask(u.id), { status: 'enviando', lockedAt: at(-4), attempts: 1 });
    expect(await queue.recoverStuck(NOW)).toBe(1);
    expect(await rem(stuck)).toMatchObject({ status: 'pendente', attempts: 2, locked_at: null });
    expect((await rem(fresh)).status).toBe('enviando');
    expect(await queue.recoverStuck(NOW)).toBe(0);
  });
});

describe('ReminderQueue.finish', () => {
  async function claimOne() {
    const u = await mkUser();
    const id = await mkReminder(u.id, await mkTask(u.id));
    const c = (await queue.claimDue(NOW, 1000)).find((x) => x.reminderId === id)!;
    return { u, id, attempts: c.attempts };
  }

  it('enviado sets sent_at and clears the lock', async () => {
    const { id, attempts } = await claimOne();
    await queue.finish({ reminderId: id, attempts, status: 'enviado', error: null, nextAttemptAt: null }, at(1));
    const r = await rem(id);
    expect(r.status).toBe('enviado');
    expect(r.sent_at?.toISOString()).toBe(at(1).toISOString());
    expect(r.locked_at).toBeNull();
    expect(r.last_error).toBeNull();
  });

  it('pendente stores next_attempt_at and the error', async () => {
    const { id, attempts } = await claimOne();
    await queue.finish({ reminderId: id, attempts, status: 'pendente', error: 'transitorio', nextAttemptAt: at(5) }, at(1));
    const r = await rem(id);
    expect(r.status).toBe('pendente');
    expect(r.next_attempt_at?.toISOString()).toBe(at(5).toISOString());
    expect(r.last_error).toBe('transitorio');
    expect(r.locked_at).toBeNull();
  });

  it('falhou and cancelado record the status and error', async () => {
    const a = await claimOne();
    await queue.finish({ reminderId: a.id, attempts: a.attempts, status: 'falhou', error: 'bot_bloqueado', nextAttemptAt: null }, at(1));
    expect(await rem(a.id)).toMatchObject({ status: 'falhou', last_error: 'bot_bloqueado' });
    const b = await claimOne();
    await queue.finish({ reminderId: b.id, attempts: b.attempts, status: 'cancelado', error: null, nextAttemptAt: null }, at(1));
    expect((await rem(b.id)).status).toBe('cancelado');
  });

  it('maps the three lease errors to ReminderLeaseError with the SQL code', async () => {
    const { id, attempts } = await claimOne();
    const base = { reminderId: id, attempts, status: 'enviado' as const, error: null, nextAttemptAt: null };

    await expect(queue.finish({ ...base, reminderId: randomUUID() }, at(1))).rejects.toMatchObject({
      name: 'ReminderLeaseError',
      code: 'lembrete_inexistente',
    });
    await expect(queue.finish({ ...base, attempts: attempts + 1 }, at(1))).rejects.toMatchObject({
      code: 'lembrete_reservado_por_outro',
    });
    expect((await rem(id)).status).toBe('enviando');
    await queue.finish(base, at(1));
    const err = await queue.finish(base, at(2)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReminderLeaseError);
    expect((err as ReminderLeaseError).code).toBe('lembrete_em_estado_invalido');
  });

  it('lets other database errors propagate as plain errors (retry without a time, broken client)', async () => {
    const { id, attempts } = await claimOne();
    const err = await queue
      .finish({ reminderId: id, attempts, status: 'pendente', error: null, nextAttemptAt: null }, at(1))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ReminderLeaseError);
    expect((err as Error).message).toContain('lembrete_sem_proxima_tentativa');

    const broken = createSupabaseReminderQueue(brokenClient());
    const err2 = await broken
      .finish({ reminderId: id, attempts, status: 'enviado', error: null, nextAttemptAt: null }, at(1))
      .catch((e: unknown) => e);
    expect(err2).toBeInstanceOf(Error);
    expect(err2).not.toBeInstanceOf(ReminderLeaseError);
    await expect(broken.claimDue(NOW, 1)).rejects.toThrow();
    await expect(broken.cancelDead(NOW)).rejects.toThrow();
    await expect(broken.recoverStuck(NOW)).rejects.toThrow();
    await expect(broken.pauseChannel(id)).rejects.toThrow();
  });
});

describe('ReminderQueue.pauseChannel', () => {
  it('pauses only that user', async () => {
    const a = await mkUser();
    const b = await mkUser();
    await queue.pauseChannel(a.id);
    expect((await profile(a.id)).channel_paused).toBe(true);
    expect((await profile(b.id)).channel_paused).toBe(false);
    expect(String((await profile(a.id)).telegram_chat_id)).toBe(String(a.chat));
  });
});

describe('LinkCodeRepository', () => {
  const code = () => `T${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const codesOf = async (userId: string): Promise<string[]> =>
    (await pool.query(`select code from public.link_codes where user_id = $1 order by code`, [userId])).rows.map(
      (r: { code: string }) => r.code,
    );

  it('create replaces ALL previous codes of the user and leaves other users alone', async () => {
    const a = await mkUser({ chat: null });
    const b = await mkUser({ chat: null });
    const [c1, c2, c3, cb] = [code(), code(), code(), code()];
    // Vários códigos antigos do mesmo usuário, inseridos direto.
    for (const c of [c1, c2]) {
      await pool.query(`insert into public.link_codes (code, user_id, expires_at) values ($1, $2, $3)`, [c, a.id, at(10)]);
    }
    await links.create(b.id, cb, at(10));
    await links.create(a.id, c3, at(10));
    expect(await codesOf(a.id)).toEqual([c3]);
    expect(await codesOf(b.id)).toEqual([cb]);
    const { rows } = await pool.query(`select expires_at from public.link_codes where code = $1`, [c3]);
    expect(rows[0].expires_at.toISOString()).toBe(at(10).toISOString());
    expect(await links.consume(c1, newChatId(), NOW)).toEqual({ status: 'invalido' });
  });

  it('consume ok links the chat, clears the pause and is single use', async () => {
    const a = await mkUser({ chat: null, paused: true });
    const c = code();
    const chat = newChatId();
    await links.create(a.id, c, at(10));
    expect(await links.consume(c, chat, NOW)).toEqual({
      status: 'ok',
      userId: a.id,
      // Usuário inserido direto em auth.users (sem o resto das colunas do GoTrue): a consulta pela API
      // administrativa falha e a dica degrada para null, sem erro. A dica real é coberta em telegram.db.test.ts.
      accountHint: null,
    });
    expect(await profile(a.id)).toEqual({ telegram_chat_id: String(chat), channel_paused: false });
    expect(await codesOf(a.id)).toEqual([]);
    expect(await links.consume(c, chat, NOW)).toEqual({ status: 'invalido' });
  });

  it('consume invalido for unknown and expired codes, never linking', async () => {
    const a = await mkUser({ chat: null });
    const c = code();
    await links.create(a.id, c, at(10));
    expect(await links.consume('NAO_EXISTE', newChatId(), NOW)).toEqual({ status: 'invalido' });
    expect(await links.consume(c, newChatId(), at(10))).toEqual({ status: 'invalido' });
    expect((await profile(a.id)).telegram_chat_id).toBeNull();
  });

  it('consume chat_em_uso when the chat belongs to another user, keeping the code', async () => {
    const owner = await mkUser();
    const other = await mkUser({ chat: null });
    const c = code();
    await links.create(other.id, c, at(10));
    expect(await links.consume(c, owner.chat!, NOW)).toEqual({ status: 'chat_em_uso' });
    expect(await codesOf(other.id)).toEqual([c]);
    expect((await profile(other.id)).telegram_chat_id).toBeNull();
    expect(String((await profile(owner.id)).telegram_chat_id)).toBe(String(owner.chat));
  });

  it('unlink sets telegram_chat_id to null for that user only', async () => {
    const a = await mkUser();
    const b = await mkUser();
    await links.unlink(a.id);
    expect((await profile(a.id)).telegram_chat_id).toBeNull();
    expect(String((await profile(b.id)).telegram_chat_id)).toBe(String(b.chat));
  });

  it('userForChat returns the owner, null when unlinked or unknown, and never another user', async () => {
    const a = await mkUser();
    const b = await mkUser();
    expect(await links.userForChat(a.chat!)).toBe(a.id);
    expect(await links.userForChat(b.chat!)).toBe(b.id);
    expect(await links.userForChat(newChatId())).toBeNull();
    await links.unlink(a.id);
    expect(await links.userForChat(a.chat!)).toBeNull();
    expect(await links.userForChat(b.chat!)).toBe(b.id);
  });

  it('propagates database failures', async () => {
    const broken = createSupabaseLinkRepository(brokenClient());
    await expect(broken.create('x', 'c', NOW)).rejects.toThrow();
    await expect(broken.consume('c', 1, NOW)).rejects.toThrow();
    await expect(broken.unlink('x')).rejects.toThrow();
    await expect(broken.userForChat(1)).rejects.toThrow();
  });
});

describe('ConfirmationRepository', () => {
  const msg = () => Math.floor(Math.random() * 1_000_000_000);

  it('record is idempotent (primary key) and tasksFor returns the alive ids', async () => {
    const a = await mkUser();
    const t1 = await mkTask(a.id);
    const t2 = await mkTask(a.id);
    const chat = newChatId();
    const m = msg();
    await confirmations.record(chat, m, [t1, t2]);
    await confirmations.record(chat, m, [t1, t2]);
    await confirmations.record(chat, m, [t2]);
    const { rows } = await pool.query(
      `select count(*)::int as n from public.task_confirmations where chat_id = $1 and message_id = $2`,
      [chat, m],
    );
    expect(rows[0].n).toBe(2);
    expect(await confirmations.tasksFor(a.id, chat, m)).toEqual({ alive: [t1, t2].sort(), deletedCount: 0 });
    await confirmations.record(chat, m, []);
  });

  it('stores channel telegram', async () => {
    const a = await mkUser();
    const t = await mkTask(a.id);
    const chat = newChatId();
    const m = msg();
    await confirmations.record(chat, m, [t]);
    const { rows } = await pool.query(`select channel from public.task_confirmations where chat_id = $1 and message_id = $2`, [chat, m]);
    expect(rows).toEqual([{ channel: 'telegram' }]);
  });

  it("isolates users: B never sees A's tasks, even for the same chat and message", async () => {
    const a = await mkUser();
    const b = await mkUser();
    const ta = await mkTask(a.id);
    const tb = await mkTask(b.id);
    const chat = newChatId();
    const m = msg();
    await confirmations.record(chat, m, [ta, tb]);
    expect(await confirmations.tasksFor(a.id, chat, m)).toEqual({ alive: [ta], deletedCount: 0 });
    expect(await confirmations.tasksFor(b.id, chat, m)).toEqual({ alive: [tb], deletedCount: 0 });
    const c = await mkUser();
    expect(await confirmations.tasksFor(c.id, chat, m)).toEqual({ alive: [], deletedCount: 0 });
  });

  it('counts soft-deleted tasks separately', async () => {
    const a = await mkUser();
    const alive = await mkTask(a.id);
    const gone1 = await mkTask(a.id, { deleted: true });
    const gone2 = await mkTask(a.id, { deleted: true });
    const chat = newChatId();
    const m = msg();
    await confirmations.record(chat, m, [alive, gone1, gone2]);
    expect(await confirmations.tasksFor(a.id, chat, m)).toEqual({ alive: [alive], deletedCount: 2 });
  });

  it('is empty for an unknown message or another chat', async () => {
    const a = await mkUser();
    const t = await mkTask(a.id);
    const chat = newChatId();
    const m = msg();
    await confirmations.record(chat, m, [t]);
    expect(await confirmations.tasksFor(a.id, chat, m + 1)).toEqual({ alive: [], deletedCount: 0 });
    expect(await confirmations.tasksFor(a.id, chat + 1, m)).toEqual({ alive: [], deletedCount: 0 });
  });

  it('propagates database failures', async () => {
    const broken = createSupabaseConfirmationRepository(brokenClient());
    await expect(broken.record(1, 1, [randomUUID()])).rejects.toThrow();
    await expect(broken.tasksFor('x', 1, 1)).rejects.toThrow();
  });
});

describe('MaintenanceRepository', () => {
  it('purgeExpiredChatMessages returns how many it deleted (strictly expired)', async () => {
    const a = await mkUser();
    const ins = (expires: Date) =>
      pool.query(
        `insert into public.chat_messages (user_id, channel, role, content, created_at, expires_at)
         values ($1, 'painel', 'user', 'x', $2, $3)`,
        [a.id, at(-24 * 60).toISOString(), expires.toISOString()],
      );
    await ins(at(-1));
    await ins(at(-2));
    await ins(NOW);
    await ins(at(1));
    expect(await maintenance.purgeExpiredChatMessages(NOW)).toBe(2);
    expect(await maintenance.purgeExpiredChatMessages(NOW)).toBe(0);
    const { rows } = await pool.query(`select count(*)::int as n from public.chat_messages where user_id = $1`, [a.id]);
    expect(rows[0].n).toBe(2);
  });

  it('purgeExpiredLinkCodes returns how many it deleted', async () => {
    const [a, b, c] = [await mkUser({ chat: null }), await mkUser({ chat: null }), await mkUser({ chat: null })];
    const ins = (u: string, expires: Date) =>
      pool.query(`insert into public.link_codes (code, user_id, expires_at) values ($1, $2, $3)`, [
        `P${randomUUID().replace(/-/g, '').slice(0, 10)}`,
        u,
        expires.toISOString(),
      ]);
    await ins(a.id, at(-1));
    await ins(b.id, NOW);
    await ins(c.id, at(1));
    expect(await maintenance.purgeExpiredLinkCodes(NOW)).toBe(1);
  });

  it('purgeOldModelCalls returns how many calls older than 2 days it deleted', async () => {
    const a = await mkUser();
    const ins = async (calledAt: Date) => {
      await pool.query(
        `insert into public.assistant_model_calls (user_id, channel, called_at) values ($1, 'painel', $2)`,
        [a.id, calledAt.toISOString()],
      );
    };
    await ins(at(-60 * 48 - 1));
    await ins(at(-60 * 48));
    await ins(at(-10));
    expect(await maintenance.purgeOldModelCalls(NOW)).toBe(1);
  });

  it('recoverStuckEvents returns { recovered, failed } with the SQL semantics', async () => {
    const a = await mkUser();
    const ins = async (receivedAt: Date, status: string, attempts: number) => {
      const ext = `ext-${randomUUID()}`;
      await pool.query(
        `insert into public.inbound_events (user_id, channel, external_id, status, received_at, attempt_count)
         values ($1, 'painel', $2, $3, $4, $5)`,
        [a.id, ext, status, receivedAt.toISOString(), attempts],
      );
      return ext;
    };
    const withCall = await ins(at(-3), 'processando', 1);
    const noCall = await ins(at(-3), 'recebido', 0);
    await ins(at(-3), 'processando', 2);
    const fresh = await ins(at(-1), 'processando', 1);
    await ins(at(-30), 'processado', 1);
    expect(await maintenance.recoverStuckEvents(NOW)).toEqual({ recovered: 2, failed: 1 });
    expect(await maintenance.recoverStuckEvents(NOW)).toEqual({ recovered: 0, failed: 0 });
    const status = async (ext: string) =>
      (await pool.query(`select status from public.inbound_events where external_id = $1`, [ext])).rows[0].status;
    expect(await status(withCall)).toBe('processado');
    expect(await status(noCall)).toBe('falhou');
    expect(await status(fresh)).toBe('processando');
  });

  it('propagates database failures', async () => {
    const broken = createSupabaseMaintenanceRepository(brokenClient());
    await expect(broken.purgeExpiredChatMessages(NOW)).rejects.toThrow();
    await expect(broken.purgeExpiredLinkCodes(NOW)).rejects.toThrow();
    await expect(broken.purgeOldModelCalls(NOW)).rejects.toThrow();
    await expect(broken.recoverStuckEvents(NOW)).rejects.toThrow();
  });
});
