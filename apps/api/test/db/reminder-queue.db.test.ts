import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { asServiceRole, closePool, createUser, deleteCreatedUsers, pool } from './helpers';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

// Relógio fixo, longe dos dados de outros testes.
const NOW = new Date('2031-06-15T12:00:00.000Z');
const at = (minutes: number): string => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const NOW_ISO = NOW.toISOString();

const clients: pg.Client[] = [];
async function newClient(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString });
  await c.connect();
  clients.push(c);
  return c;
}

afterAll(async () => {
  for (const c of clients) await c.end().catch(() => undefined);
  await deleteCreatedUsers();
  await closePool();
}, 60_000);

let chatSeq = 0;
const newChatId = (): number => 7_000_000_000 + Math.floor(Math.random() * 1_000_000_000) * 10 + (chatSeq++ % 10);

type UserOpts = { chat?: number | null; paused?: boolean };
/** Cria um usuário; por padrão com Telegram vinculado e canal ativo. */
async function mkUser(opts: UserOpts = {}): Promise<{ id: string; chat: number | null }> {
  const id = await createUser();
  const chat = opts.chat === undefined ? newChatId() : opts.chat;
  await pool.query(`update public.profiles set telegram_chat_id = $2, channel_paused = $3 where id = $1`, [
    id,
    chat,
    opts.paused ?? false,
  ]);
  return { id, chat };
}

type TaskOpts = { status?: string; deleted?: boolean; title?: string; type?: string; fatal?: boolean };
async function mkTask(userId: string, o: TaskOpts = {}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into public.tasks (id, user_id, title, type, status, fatal, due_date, due_time, deleted_at)
     values ($1, $2, $3, $4, $5, $6, '2031-06-16', '14:30', $7)`,
    [id, userId, o.title ?? 'Tarefa', o.type ?? 'tarefa', o.status ?? 'pendente', o.fatal ?? false, o.deleted ? NOW_ISO : null],
  );
  return id;
}

type RemOpts = {
  kind?: string;
  scheduledAt?: string;
  status?: string;
  lockedAt?: string | null;
  nextAttemptAt?: string | null;
  attempts?: number;
};
async function mkReminder(userId: string, taskId: string, o: RemOpts = {}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into public.reminders (id, user_id, task_id, kind, scheduled_at, status, locked_at, next_attempt_at, attempts)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      userId,
      taskId,
      o.kind ?? 'no_horario',
      o.scheduledAt ?? at(-10),
      o.status ?? 'pendente',
      o.lockedAt ?? null,
      o.nextAttemptAt ?? null,
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

type Claimed = { reminder_id: string; user_id: string; task_id: string; [k: string]: unknown };
async function claim(now: string, limit: number, c?: pg.Client): Promise<Claimed[]> {
  const q = c ?? pool;
  const { rows } = await q.query(`select * from public.claim_due_reminders($1::timestamptz, $2::int)`, [now, limit]);
  return rows as Claimed[];
}

/** Um usuário com Telegram e `n` lembretes vencidos, cada um em sua própria tarefa. */
async function seedDue(n: number, scheduledAt = at(-10)): Promise<{ userId: string; ids: string[] }> {
  const u = await mkUser();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = await mkTask(u.id);
    ids.push(await mkReminder(u.id, t, { scheduledAt }));
  }
  return { userId: u.id, ids };
}

describe('claim_due_reminders', () => {
  it('4 simultaneous callers (limit 10) reserve 20 distinct reminders, all enviando with attempts 1', async () => {
    const { ids } = await seedDue(20);
    const conns = await Promise.all([newClient(), newClient(), newClient(), newClient()]);
    const results = await Promise.all(conns.map((c) => claim(NOW_ISO, 10, c)));
    const got = results.flat().map((r) => r.reminder_id);
    expect(new Set(got).size).toBe(got.length);
    const mine = got.filter((id) => ids.includes(id));
    expect(mine.length).toBe(20);
    for (const id of ids) {
      const r = await rem(id);
      expect(r.status).toBe('enviando');
      expect(r.attempts).toBe(1);
      expect(r.locked_at?.toISOString()).toBe(NOW_ISO);
    }
  });

  it('skips a row locked by another transaction instead of waiting for it', async () => {
    const { ids } = await seedDue(3);
    const holder = await newClient();
    await holder.query('begin');
    await holder.query(`select 1 from public.reminders where id = $1 for update`, [ids[0]]);
    const claimer = await newClient();
    await claimer.query(`set statement_timeout = 2000`);
    let got: string[];
    try {
      got = (await claim(NOW_ISO, 50, claimer)).map((r) => r.reminder_id);
    } finally {
      await holder.query('rollback');
    }
    expect(got).not.toContain(ids[0]);
    expect(got).toContain(ids[1]);
    expect(got).toContain(ids[2]);
    expect((await rem(ids[0]!)).status).toBe('pendente');
  });

  it('returns the joined data for the sender, oldest first', async () => {
    const u = await mkUser();
    await pool.query(`update public.profiles set timezone = 'America/Manaus' where id = $1`, [u.id]);
    const t1 = await mkTask(u.id, { title: 'Audiência X', type: 'audiencia', fatal: true });
    const t2 = await mkTask(u.id, { title: 'Mais antigo' });
    const newer = await mkReminder(u.id, t1, { scheduledAt: at(-5), kind: 'antecipado' });
    const older = await mkReminder(u.id, t2, { scheduledAt: at(-60) });
    const rows = (await claim(NOW_ISO, 1000)).filter((r) => r.user_id === u.id);
    expect(rows.map((r) => r.reminder_id)).toEqual([older, newer]);
    expect(rows[1]).toMatchObject({
      user_id: u.id,
      task_id: t1,
      kind: 'antecipado',
      attempts: 1,
      title: 'Audiência X',
      task_type: 'audiencia',
      fatal: true,
      telegram_chat_id: String(u.chat),
      timezone: 'America/Manaus',
    });
    expect(new Date(rows[1]!.scheduled_at as string).toISOString()).toBe(at(-5));
    expect(rows[1]!.due_date).toBeInstanceOf(Date);
    expect(String(rows[1]!.due_time).slice(0, 5)).toBe('14:30');
  });

  it('respects the limit and does not reserve a reminder that is not due yet', async () => {
    const u = await mkUser();
    const due = await mkReminder(u.id, await mkTask(u.id), { scheduledAt: at(-1) });
    const future = await mkReminder(u.id, await mkTask(u.id), { scheduledAt: at(1) });
    const got = (await claim(NOW_ISO, 1000)).map((r) => r.reminder_id);
    expect(got).toContain(due);
    expect(got).not.toContain(future);
    const { ids } = await seedDue(5);
    const limited = (await claim(NOW_ISO, 2)).map((r) => r.reminder_id);
    expect(limited).toHaveLength(2);
    expect((await claim(NOW_ISO, 0)).length).toBe(0);
    await pool.query(`update public.reminders set status = 'cancelado' where id = any($1::uuid[])`, [ids]);
  });

  it('never reserves a reminder of a deleted or closed task; cancel_dead_reminders cancels them', async () => {
    const u = await mkUser();
    const alive = await mkReminder(u.id, await mkTask(u.id), {});
    const ongoing = await mkReminder(u.id, await mkTask(u.id, { status: 'em_andamento' }), {});
    const deleted = await mkReminder(u.id, await mkTask(u.id, { deleted: true }), {});
    const done = await mkReminder(u.id, await mkTask(u.id, { status: 'concluida' }), {});
    const cancelled = await mkReminder(u.id, await mkTask(u.id, { status: 'cancelada' }), {});
    const got = (await claim(NOW_ISO, 1000)).map((r) => r.reminder_id);
    expect(got).toContain(alive);
    expect(got).toContain(ongoing);
    for (const id of [deleted, done, cancelled]) {
      expect(got).not.toContain(id);
      expect((await rem(id)).status).toBe('pendente');
    }
    const { rows } = await pool.query(`select public.cancel_dead_reminders($1::timestamptz) as n`, [NOW_ISO]);
    expect(rows[0].n).toBeGreaterThanOrEqual(3);
    for (const id of [deleted, done, cancelled]) {
      const r = await rem(id);
      expect(r.status).toBe('cancelado');
      expect(r.last_error).toBe('tarefa_encerrada');
    }
    expect((await rem(alive)).status).toBe('enviando');
  });

  it('does not reserve reminders of a profile with no chat or with a paused channel', async () => {
    const noChat = await mkUser({ chat: null });
    const paused = await mkUser({ paused: true });
    const r1 = await mkReminder(noChat.id, await mkTask(noChat.id));
    const r2 = await mkReminder(paused.id, await mkTask(paused.id));
    const got = (await claim(NOW_ISO, 1000)).map((r) => r.reminder_id);
    expect(got).not.toContain(r1);
    expect(got).not.toContain(r2);
    expect((await rem(r1)).status).toBe('pendente');
    expect((await rem(r2)).status).toBe('pendente');
  });

  it('never reserves a reminder more than 24 h late, even without cancel_dead_reminders', async () => {
    const u = await mkUser();
    const late = await mkReminder(u.id, await mkTask(u.id), { scheduledAt: at(-24 * 60 - 1) });
    const edge = await mkReminder(u.id, await mkTask(u.id), { scheduledAt: at(-24 * 60) });
    const got = (await claim(NOW_ISO, 1000)).map((r) => r.reminder_id);
    expect(got).not.toContain(late);
    expect(got).toContain(edge);
    expect((await rem(late)).status).toBe('pendente');
  });

  it('is only claimable after next_attempt_at (boundary is <=)', async () => {
    const u = await mkUser();
    const id = await mkReminder(u.id, await mkTask(u.id), { scheduledAt: at(-30), nextAttemptAt: at(5) });
    expect((await claim(at(4), 1000)).map((r) => r.reminder_id)).not.toContain(id);
    expect((await claim(at(5), 1000)).map((r) => r.reminder_id)).toContain(id);
  });

  it('does not touch another user when the first one is processed (isolation)', async () => {
    const a = await mkUser();
    const b = await mkUser({ paused: true });
    await mkReminder(a.id, await mkTask(a.id));
    const rb = await mkReminder(b.id, await mkTask(b.id, { deleted: true }), { scheduledAt: at(-60 * 30) });
    await claim(NOW_ISO, 1000);
    await pool.query(`select public.recover_stuck_reminders($1::timestamptz)`, [NOW_ISO]);
    expect((await rem(rb)).status).toBe('pendente');
  });
});

describe('cancel_dead_reminders', () => {
  it('cancels a pendente reminder older than 24 h and keeps one just inside the limit', async () => {
    const u = await mkUser();
    const old = await mkReminder(u.id, await mkTask(u.id), { scheduledAt: at(-25 * 60) });
    const edge = await mkReminder(u.id, await mkTask(u.id), { scheduledAt: at(-24 * 60) });
    const recent = await mkReminder(u.id, await mkTask(u.id), { scheduledAt: at(-23 * 60) });
    const { rows } = await pool.query(`select public.cancel_dead_reminders($1::timestamptz) as n`, [NOW_ISO]);
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
    expect(await rem(old)).toMatchObject({ status: 'cancelado', last_error: 'atrasado_demais' });
    expect((await rem(edge)).status).toBe('pendente');
    expect((await rem(recent)).status).toBe('pendente');
  });

  it('only touches pendente reminders', async () => {
    const u = await mkUser();
    const t = await mkTask(u.id, { deleted: true });
    const sending = await mkReminder(u.id, t, { status: 'enviando', kind: 'no_dia', lockedAt: at(-1) });
    const sent = await mkReminder(u.id, t, { status: 'enviado', scheduledAt: at(-60 * 48) });
    await pool.query(`select public.cancel_dead_reminders($1::timestamptz)`, [NOW_ISO]);
    expect((await rem(sending)).status).toBe('enviando');
    expect((await rem(sent)).status).toBe('enviado');
  });
});

describe('recover_stuck_reminders', () => {
  it('returns a 6-minute enviando to pendente (attempts kept, lock cleared) and leaves 2 minutes alone', async () => {
    const u = await mkUser();
    const stuck = await mkReminder(u.id, await mkTask(u.id), { status: 'enviando', lockedAt: at(-6), attempts: 2 });
    const fresh = await mkReminder(u.id, await mkTask(u.id), { status: 'enviando', lockedAt: at(-2), attempts: 1 });
    const edge = await mkReminder(u.id, await mkTask(u.id), { status: 'enviando', lockedAt: at(-5), attempts: 1 });
    const { rows } = await pool.query(`select public.recover_stuck_reminders($1::timestamptz) as n`, [NOW_ISO]);
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
    expect(await rem(stuck)).toMatchObject({ status: 'pendente', attempts: 2, locked_at: null });
    expect((await rem(fresh)).status).toBe('enviando');
    expect((await rem(edge)).status).toBe('enviando');
  });
});

describe('finish_reminder', () => {
  const finish = (id: string, status: string, error: string | null, next: string | null, attempts = 1) =>
    pool.query(`select public.finish_reminder($1::uuid, $2::int, $3, $4, $5::timestamptz, $6::timestamptz)`, [
      id,
      attempts,
      status,
      error,
      next,
      NOW_ISO,
    ]);

  async function sending(attempts = 1): Promise<{ id: string; userId: string }> {
    const u = await mkUser();
    const id = await mkReminder(u.id, await mkTask(u.id), { status: 'enviando', lockedAt: NOW_ISO, attempts });
    return { id, userId: u.id };
  }

  it("'enviado' sets sent_at and clears the lock", async () => {
    const { id } = await sending();
    await finish(id, 'enviado', null, null);
    const r = await rem(id);
    expect(r.status).toBe('enviado');
    expect(r.sent_at?.toISOString()).toBe(NOW_ISO);
    expect(r.locked_at).toBeNull();
    expect(r.last_error).toBeNull();
  });

  it("'pendente' (retry) stores next_attempt_at and the reminder becomes claimable only then", async () => {
    const { id } = await sending();
    await finish(id, 'pendente', 'transitorio', at(5));
    const r = await rem(id);
    expect(r).toMatchObject({ status: 'pendente', locked_at: null, last_error: 'transitorio', attempts: 1 });
    expect(r.next_attempt_at?.toISOString()).toBe(at(5));
    expect((await claim(at(4), 1000)).map((x) => x.reminder_id)).not.toContain(id);
    const again = await claim(at(5), 1000);
    expect(again.map((x) => x.reminder_id)).toContain(id);
    expect(again.find((x) => x.reminder_id === id)?.attempts).toBe(2);
  });

  it("'falhou' and 'cancelado' are stored", async () => {
    const a = await sending();
    const b = await sending();
    await finish(a.id, 'falhou', 'erro', null);
    await finish(b.id, 'cancelado', 'tarefa_encerrada', null);
    expect(await rem(a.id)).toMatchObject({ status: 'falhou', last_error: 'erro', locked_at: null });
    expect(await rem(b.id)).toMatchObject({ status: 'cancelado', last_error: 'tarefa_encerrada' });
  });

  it('truncates a long error to 200 characters', async () => {
    const { id } = await sending();
    await finish(id, 'falhou', 'x'.repeat(500), null);
    expect((await rem(id)).last_error).toBe('x'.repeat(200));
  });

  it('raises lembrete_em_estado_invalido when the reminder is not enviando', async () => {
    const u = await mkUser();
    const t = await mkTask(u.id);
    const pending = await mkReminder(u.id, t, { kind: 'no_dia' });
    const sent = await mkReminder(u.id, t, { status: 'enviado', kind: 'antecipado' });
    await expect(finish(pending, 'enviado', null, null)).rejects.toThrow('lembrete_em_estado_invalido');
    await expect(finish(sent, 'falhou', null, null)).rejects.toThrow('lembrete_em_estado_invalido');
    expect((await rem(pending)).status).toBe('pendente');
    expect((await rem(sent)).status).toBe('enviado');
  });

  it('raises for an unknown reminder and for an invalid status, changing nothing', async () => {
    await expect(finish(randomUUID(), 'enviado', null, null)).rejects.toThrow('lembrete_inexistente');
    const { id } = await sending();
    for (const bad of ['enviando', 'xpto', '']) {
      await expect(finish(id, bad, null, null)).rejects.toThrow('status_invalido');
    }
    expect((await rem(id)).status).toBe('enviando');
  });

  it('a retry (pendente) without next_attempt_at raises lembrete_sem_proxima_tentativa and changes nothing', async () => {
    const { id } = await sending();
    await expect(finish(id, 'pendente', 'x', null)).rejects.toThrow('lembrete_sem_proxima_tentativa');
    expect((await rem(id)).status).toBe('enviando');
  });

  it('a wrong p_attempts on a fresh claim raises lembrete_reservado_por_outro', async () => {
    const { id } = await sending(1);
    await expect(finish(id, 'enviado', null, null, 2)).rejects.toThrow('lembrete_reservado_por_outro');
    await expect(finish(id, 'enviado', null, null, 0)).rejects.toThrow('lembrete_reservado_por_outro');
    expect((await rem(id)).status).toBe('enviando');
  });

  it('fences a sender whose lease expired: A claims, recovery + B claims, A cannot finish, C cannot claim, B can finish', async () => {
    const u = await mkUser();
    const id = await mkReminder(u.id, await mkTask(u.id), { scheduledAt: at(-10) });
    const mine = async (now: string) => (await claim(now, 1000)).find((r) => r.reminder_id === id);

    const a = await mine(NOW_ISO);
    expect(a?.attempts).toBe(1);
    // A fica lento; passam 6 minutos, a recuperação devolve o lembrete e B o reserva.
    await pool.query(`select public.recover_stuck_reminders($1::timestamptz)`, [at(6)]);
    const b = await mine(at(6));
    expect(b?.attempts).toBe(2);

    // O fim tardio de A (retry ou enviado) é recusado e não mexe na reserva de B.
    await expect(finish(id, 'pendente', 'tarde', at(7), 1)).rejects.toThrow('lembrete_reservado_por_outro');
    await expect(finish(id, 'enviado', null, null, 1)).rejects.toThrow('lembrete_reservado_por_outro');
    const held = await rem(id);
    expect(held).toMatchObject({ status: 'enviando', attempts: 2 });
    expect(held.locked_at?.toISOString()).toBe(at(6));

    // C não consegue reservar enquanto B segura.
    expect(await mine(at(8))).toBeUndefined();

    // B ainda termina normalmente.
    await finish(id, 'enviado', null, null, 2);
    expect((await rem(id)).status).toBe('enviado');
  });

  it('only changes the targeted reminder (other users untouched)', async () => {
    const a = await sending();
    const b = await sending();
    await finish(a.id, 'enviado', null, null);
    expect((await rem(b.id)).status).toBe('enviando');
  });
});

describe('consume_link_code', () => {
  const consume = (code: string, chat: number, now = NOW_ISO, c?: pg.Client) =>
    (c ?? pool)
      .query(`select * from public.consume_link_code($1, $2::bigint, $3::timestamptz)`, [code, chat, now])
      .then((r) => r.rows as { status: string; user_id: string | null }[]);
  const mkCode = async (userId: string, expiresAt = at(10)): Promise<string> => {
    const code = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    await pool.query(`insert into public.link_codes (code, user_id, expires_at) values ($1, $2, $3)`, [
      code,
      userId,
      expiresAt,
    ]);
    return code;
  };
  const codeExists = async (code: string): Promise<boolean> =>
    (await pool.query(`select 1 from public.link_codes where code = $1`, [code])).rowCount === 1;
  const profile = async (id: string) =>
    (await pool.query(`select telegram_chat_id::text as chat, channel_paused from public.profiles where id = $1`, [id]))
      .rows[0] as { chat: string | null; channel_paused: boolean };

  it('a valid code links the chat, clears the pause and is single use', async () => {
    const u = await mkUser({ chat: null, paused: true });
    const code = await mkCode(u.id);
    const chat = newChatId();
    expect(await consume(code, chat)).toEqual([{ status: 'ok', user_id: u.id }]);
    expect(await profile(u.id)).toEqual({ chat: String(chat), channel_paused: false });
    expect(await codeExists(code)).toBe(false);
    expect(await consume(code, chat)).toEqual([{ status: 'invalido', user_id: null }]);
  });

  it('an unknown code is invalido', async () => {
    expect(await consume('NAOEXIST', newChatId())).toEqual([{ status: 'invalido', user_id: null }]);
  });

  it('an expired code is invalido and never links (boundary: expires_at = now is expired)', async () => {
    const u = await mkUser({ chat: null });
    const expired = await mkCode(u.id, at(-1));
    const edge = await mkCode(u.id, NOW_ISO);
    expect(await consume(expired, newChatId())).toEqual([{ status: 'invalido', user_id: null }]);
    expect(await consume(edge, newChatId())).toEqual([{ status: 'invalido', user_id: null }]);
    expect((await profile(u.id)).chat).toBeNull();
  });

  it('a chat already linked to another account is chat_em_uso and the code stays valid', async () => {
    const owner = await mkUser();
    const u = await mkUser({ chat: null });
    const code = await mkCode(u.id);
    expect(await consume(code, owner.chat as number)).toEqual([{ status: 'chat_em_uso', user_id: null }]);
    expect(await codeExists(code)).toBe(true);
    expect((await profile(u.id)).chat).toBeNull();
    expect((await profile(owner.id)).chat).toBe(String(owner.chat));
    // Com outro chat livre, o mesmo código ainda funciona.
    const free = newChatId();
    expect(await consume(code, free)).toEqual([{ status: 'ok', user_id: u.id }]);
  });

  it('the same chat re-linking the same user is ok', async () => {
    const u = await mkUser();
    const code = await mkCode(u.id);
    expect(await consume(code, u.chat as number)).toEqual([{ status: 'ok', user_id: u.id }]);
    expect((await profile(u.id)).chat).toBe(String(u.chat));
  });

  it('two simultaneous consumptions of the same code give exactly one ok', async () => {
    const u = await mkUser({ chat: null });
    const code = await mkCode(u.id);
    const [c1, c2, c3] = await Promise.all([newClient(), newClient(), newClient()]);
    const results = (
      await Promise.all([consume(code, newChatId(), NOW_ISO, c1), consume(code, newChatId(), NOW_ISO, c2), consume(code, newChatId(), NOW_ISO, c3)])
    ).flat();
    expect(results.filter((r) => r.status === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'invalido')).toHaveLength(2);
    expect(await codeExists(code)).toBe(false);
  });

  it('two accounts racing for the same chat: one links, the other gets chat_em_uso with its code intact', async () => {
    const u1 = await mkUser({ chat: null });
    const u2 = await mkUser({ chat: null });
    const code1 = await mkCode(u1.id);
    const code2 = await mkCode(u2.id);
    const chat = newChatId();
    const [c1, c2] = await Promise.all([newClient(), newClient()]);
    const results = (await Promise.all([consume(code1, chat, NOW_ISO, c1), consume(code2, chat, NOW_ISO, c2)])).flat();
    expect(results.map((r) => r.status).sort()).toEqual(['chat_em_uso', 'ok']);
    const loser = results[0]!.status === 'ok' ? code2 : code1;
    expect(await codeExists(loser)).toBe(true);
  });
});

describe('claim_briefing / release_briefing', () => {
  const claimB = (id: string, day: string, c?: pg.Client) =>
    (c ?? pool).query(`select public.claim_briefing($1::uuid, $2::date) as ok`, [id, day]).then((r) => r.rows[0].ok as boolean);
  const releaseB = (id: string, day: string) =>
    pool.query(`select public.release_briefing($1::uuid, $2::date)`, [id, day]);
  const sentOn = async (id: string) =>
    (await pool.query(`select last_briefing_sent_on::text as d from public.profiles where id = $1`, [id])).rows[0].d as
      | string
      | null;

  it('simultaneous claims of the same day: exactly one true', async () => {
    const u = await mkUser();
    const conns = await Promise.all([newClient(), newClient(), newClient(), newClient()]);
    const results = await Promise.all(conns.map((c) => claimB(u.id, '2031-06-15', c)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await sentOn(u.id)).toBe('2031-06-15');
  });

  it('an earlier or equal day is refused, a later day is accepted', async () => {
    const u = await mkUser();
    expect(await claimB(u.id, '2031-06-15')).toBe(true);
    expect(await claimB(u.id, '2031-06-15')).toBe(false);
    expect(await claimB(u.id, '2031-06-14')).toBe(false);
    expect(await sentOn(u.id)).toBe('2031-06-15');
    expect(await claimB(u.id, '2031-06-16')).toBe(true);
  });

  it('release undoes the claim so the day can be claimed again', async () => {
    const u = await mkUser();
    expect(await claimB(u.id, '2031-06-15')).toBe(true);
    await releaseB(u.id, '2031-06-15');
    expect(await sentOn(u.id)).toBe('2031-06-14');
    expect(await claimB(u.id, '2031-06-15')).toBe(true);
  });

  it('release does nothing when the stored day differs, and never touches other users', async () => {
    const a = await mkUser();
    const b = await mkUser();
    await claimB(a.id, '2031-06-16');
    await claimB(b.id, '2031-06-15');
    await releaseB(a.id, '2031-06-15');
    expect(await sentOn(a.id)).toBe('2031-06-16');
    expect(await sentOn(b.id)).toBe('2031-06-15');
  });
});

describe('purges', () => {
  it('purge_expired_chat_messages deletes only expired messages', async () => {
    const u = await mkUser();
    const ins = (exp: string) =>
      pool.query(
        `insert into public.chat_messages (user_id, channel, role, content, expires_at)
         values ($1, 'telegram', 'user', 'oi', $2) returning id`,
        [u.id, exp],
      );
    const old = (await ins(at(-1))).rows[0].id as string;
    const edge = (await ins(NOW_ISO)).rows[0].id as string;
    const live = (await ins(at(1))).rows[0].id as string;
    const { rows } = await pool.query(`select public.purge_expired_chat_messages($1::timestamptz) as n`, [NOW_ISO]);
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
    const left = (await pool.query(`select id from public.chat_messages where user_id = $1`, [u.id])).rows.map((r) => r.id);
    expect(left.sort()).toEqual([edge, live].sort());
    expect(left).not.toContain(old);
  });

  it('purge_expired_link_codes deletes only expired codes', async () => {
    const u = await mkUser({ chat: null });
    const ins = (code: string, exp: string) =>
      pool.query(`insert into public.link_codes (code, user_id, expires_at) values ($1, $2, $3)`, [code, u.id, exp]);
    const tag = randomUUID().slice(0, 4).toUpperCase();
    await ins(`${tag}OLD1`, at(-1));
    await ins(`${tag}LIV1`, at(1));
    const { rows } = await pool.query(`select public.purge_expired_link_codes($1::timestamptz) as n`, [NOW_ISO]);
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
    const left = (await pool.query(`select code from public.link_codes where user_id = $1`, [u.id])).rows.map((r) => r.code);
    expect(left).toEqual([`${tag}LIV1`]);
  });

  it('purge_old_model_calls deletes calls older than 2 days only', async () => {
    const u = await mkUser();
    const ins = (calledAt: string) =>
      pool.query(`insert into public.assistant_model_calls (user_id, channel, called_at) values ($1, 'painel', $2)`, [
        u.id,
        calledAt,
      ]);
    await ins(at(-2 * 24 * 60 - 1));
    await ins(at(-2 * 24 * 60));
    await ins(at(-60));
    const { rows } = await pool.query(`select public.purge_old_model_calls($1::timestamptz) as n`, [NOW_ISO]);
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
    const left = await pool.query(`select called_at from public.assistant_model_calls where user_id = $1 order by called_at`, [u.id]);
    expect(left.rows.map((r) => (r.called_at as Date).toISOString())).toEqual([at(-2 * 24 * 60), at(-60)]);
  });
});

describe('recover_stuck_events', () => {
  const PARTIAL = {
    reply: 'Sua mensagem pode ter sido processada só em parte. Confira suas tarefas e envie de novo o que faltar.',
    affectedTasks: [],
  };
  async function mkEvent(userId: string | null, status: string, receivedAt: string, attempts: number): Promise<string> {
    const ext = randomUUID();
    await pool.query(
      `insert into public.inbound_events (channel, external_id, user_id, status, received_at, attempt_count)
       values ('telegram', $1, $2, $3, $4, $5)`,
      [ext, userId, status, receivedAt, attempts],
    );
    return ext;
  }
  const ev = async (ext: string) =>
    (
      await pool.query(
        `select status, reply, processed_at, attempt_count from public.inbound_events where channel = 'telegram' and external_id = $1`,
        [ext],
      )
    ).rows[0] as { status: string; reply: unknown; processed_at: Date | null; attempt_count: number };
  const recover = async () =>
    (await pool.query(`select * from public.recover_stuck_events($1::timestamptz)`, [NOW_ISO])).rows[0] as {
      recovered: number;
      failed: number;
    };

  it('covers every branch and leaves fresh and finished events alone', async () => {
    const u = await mkUser();
    const calledProcessing = await mkEvent(u.id, 'processando', at(-3), 1);
    const calledReceived = await mkEvent(u.id, 'recebido', at(-3), 2);
    const noCall = await mkEvent(u.id, 'recebido', at(-3), 0);
    const noCallNoUser = await mkEvent(null, 'recebido', at(-10), 0);
    const freshProcessing = await mkEvent(u.id, 'processando', at(-1), 1);
    const freshReceived = await mkEvent(u.id, 'recebido', at(-1), 0);
    const edge = await mkEvent(u.id, 'processando', at(-2), 1);
    const done = await mkEvent(u.id, 'processado', at(-60), 1);
    const failed = await mkEvent(u.id, 'falhou', at(-60), 1);

    const r = await recover();
    expect(r.recovered).toBeGreaterThanOrEqual(2);
    expect(r.failed).toBeGreaterThanOrEqual(2);

    for (const ext of [calledProcessing, calledReceived]) {
      const e = await ev(ext);
      expect(e.status).toBe('processado');
      expect(e.reply).toEqual(PARTIAL);
      expect(e.processed_at?.toISOString()).toBe(NOW_ISO);
    }
    for (const ext of [noCall, noCallNoUser]) {
      const e = await ev(ext);
      expect(e.status).toBe('falhou');
      expect(e.reply).toBeNull();
    }
    expect((await ev(freshProcessing)).status).toBe('processando');
    expect((await ev(freshReceived)).status).toBe('recebido');
    expect((await ev(edge)).status).toBe('processando');
    expect(await ev(done)).toMatchObject({ status: 'processado', reply: null });
    expect((await ev(failed)).status).toBe('falhou');

    // Segunda rodada: nada novo para essas linhas.
    const again = await recover();
    expect(again.recovered).toBe(0);
    expect(again.failed).toBe(0);
  });

  it('a resend of a recovered event replays the partial reply (never creates again)', async () => {
    const u = await mkUser();
    const ext = await mkEvent(u.id, 'processando', at(-5), 1);
    await recover();
    const { rows } = await pool.query(
      `select * from public.register_inbound_event($1::uuid, 'telegram', $2, $3::timestamptz)`,
      [u.id, ext, NOW_ISO],
    );
    expect(rows).toEqual([{ first_time: false, status: 'processado', reply: PARTIAL }]);
  });

  it('a resend of an event that had no model call is processed again (reset to recebido)', async () => {
    const u = await mkUser();
    const ext = await mkEvent(u.id, 'recebido', at(-5), 0);
    await recover();
    expect((await ev(ext)).status).toBe('falhou');
    const { rows } = await pool.query(
      `select * from public.register_inbound_event($1::uuid, 'telegram', $2, $3::timestamptz)`,
      [u.id, ext, NOW_ISO],
    );
    expect(rows).toEqual([{ first_time: true, status: 'recebido', reply: null }]);
    expect((await ev(ext)).status).toBe('recebido');
  });

  it('simultaneous recoveries count each event once', async () => {
    const u = await mkUser();
    const exts: string[] = [];
    for (let i = 0; i < 6; i++) exts.push(await mkEvent(u.id, 'processando', at(-5), 1));
    const conns = await Promise.all([newClient(), newClient(), newClient()]);
    const results = await Promise.all(
      conns.map((c) =>
        c
          .query(`select * from public.recover_stuck_events($1::timestamptz)`, [NOW_ISO])
          .then((r) => r.rows[0] as { recovered: number; failed: number }),
      ),
    );
    const { rows } = await pool.query(
      `select count(*)::int as n from public.inbound_events where external_id = any($1::text[]) and status = 'processado'`,
      [exts],
    );
    expect(rows[0].n).toBe(6);
    expect(results.reduce((s, r) => s + r.recovered, 0)).toBeGreaterThanOrEqual(6);
    // Nenhum evento é contado duas vezes: uma rodada seguinte não encontra mais nada.
    expect((await recover()).recovered).toBe(0);
  });
});

describe('privileges', () => {
  const NAMES = [
    'claim_due_reminders',
    'cancel_dead_reminders',
    'recover_stuck_reminders',
    'finish_reminder',
    'consume_link_code',
    'claim_briefing',
    'release_briefing',
    'purge_expired_chat_messages',
    'purge_expired_link_codes',
    'purge_old_model_calls',
    'recover_stuck_events',
  ];

  it('every new function is executable only by service_role, is security invoker and pins search_path', async () => {
    const { rows } = await pool.query(
      `select p.proname, r.role, has_function_privilege(r.role, p.oid, 'EXECUTE') as can,
              p.prosecdef, p.proconfig
         from pg_proc p cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role)
        where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[])`,
      [NAMES],
    );
    expect(rows).toHaveLength(NAMES.length * 3);
    for (const r of rows) {
      expect(r.can).toBe(r.role === 'service_role');
      expect(r.prosecdef).toBe(false);
      expect(r.proconfig).toContain('search_path=public');
    }
  });

  it('service_role can call the queue functions through its own role', async () => {
    const u = await mkUser();
    const id = await mkReminder(u.id, await mkTask(u.id));
    const got = await asServiceRole(async (q) => {
      const r = await q(`select reminder_id from public.claim_due_reminders($1::timestamptz, 1000)`, [NOW_ISO]);
      return r.rows.map((x) => x.reminder_id as string);
    });
    expect(got).toContain(id);
    await pool.query(`update public.reminders set status = 'cancelado' where id = $1`, [id]);
  });
});
