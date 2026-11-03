import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { TelegramClient } from '../../src/application/ports.js';
import { buildApp } from '../../src/compose.js';
import { closePool, createUser, deleteCreatedUsers, pool } from './helpers.js';
import { getSupabaseEnv } from './supabase-env.js';

// Relógio fixo, longe dos dados dos outros testes. Em São Paulo são 09:00 do dia 2032-03-10.
const NOW = new Date('2032-03-10T12:00:00.000Z');
const at = (minutes: number): string => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const SECRET = 'TEST_SECRET_123';
const env = getSupabaseEnv();

const baseConfig = {
  supabaseUrl: env.url,
  serviceRoleKey: env.serviceRoleKey,
  port: 0,
  webOrigin: 'http://localhost:3000',
  assistantModel: 'x',
};
const clock = { now: () => NOW };

/** Telegram falso: registra (chat, texto) e demora um pouco para as duas execuções se sobreporem. */
function fakeTelegram() {
  const sent: Array<{ chatId: number; text: string }> = [];
  const client: TelegramClient = {
    async sendMessage(chatId, text) {
      await new Promise((r) => setTimeout(r, 25));
      sent.push({ chatId, text });
      return { ok: true, messageId: 1000 + sent.length };
    },
  };
  return { client, sent };
}

const withTelegram = (client: TelegramClient) =>
  buildApp({ ...baseConfig, internalSecret: SECRET }, { clock, telegramClient: client });
const withoutTelegram = () => buildApp({ ...baseConfig, internalSecret: SECRET }, { clock });

const tick = (app: ReturnType<typeof buildApp>) =>
  app.request('/internal/reminders/run', { method: 'POST', headers: { 'X-Internal-Secret': SECRET } });

let chatSeq = 0;
async function mkUser(): Promise<{ id: string; chat: number }> {
  const id = await createUser();
  const chat = 8_100_000_000 + Math.floor(Math.random() * 1_000_000) * 10 + (chatSeq++ % 10);
  // briefing_time fora da janela (09:00 local): o briefing não interfere nestes testes.
  await pool.query(`update public.profiles set telegram_chat_id = $2, briefing_time = '23:00' where id = $1`, [id, chat]);
  return { id, chat };
}

async function mkTask(userId: string, title: string, status = 'pendente'): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into public.tasks (id, user_id, title, type, status, fatal, due_date, due_time)
     values ($1, $2, $3, 'tarefa', $4, false, '2032-03-11', '14:30')`,
    [id, userId, title, status],
  );
  return id;
}

async function mkReminder(userId: string, taskId: string, scheduledAt: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into public.reminders (id, user_id, task_id, kind, scheduled_at, status, attempts)
     values ($1, $2, $3, 'no_horario', $4, 'pendente', 0)`,
    [id, userId, taskId, scheduledAt],
  );
  return id;
}

async function reminder(id: string) {
  const { rows } = await pool.query(`select status, attempts, sent_at from public.reminders where id = $1`, [id]);
  return rows[0] as { status: string; attempts: number; sent_at: Date | null };
}

afterAll(async () => {
  await deleteCreatedUsers();
  await closePool();
}, 60_000);

describe('POST /internal/reminders/run (real database, fake Telegram)', () => {
  it('two SIMULTANEOUS requests send each due reminder exactly once and record enviado', async () => {
    const u = await mkUser();
    const titles = ['alfa', 'bravo', 'charlie', 'delta'].map((t) => `${t}-${randomUUID().slice(0, 8)}`);
    const ids: string[] = [];
    for (const title of titles) ids.push(await mkReminder(u.id, await mkTask(u.id, title), at(-10)));

    const tg = fakeTelegram();
    const app = withTelegram(tg.client);
    const [a, b] = await Promise.all([tick(app), tick(app)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const ja = (await a.json()) as { reminders: { sent: number } };
    const jb = (await b.json()) as { reminders: { sent: number } };

    expect(ja.reminders.sent + jb.reminders.sent).toBe(4);
    const mine = tg.sent.filter((m) => m.chatId === u.chat);
    expect(mine).toHaveLength(4);
    for (const title of titles) expect(mine.filter((m) => m.text.includes(title))).toHaveLength(1);
    for (const id of ids) {
      const r = await reminder(id);
      expect(r.status).toBe('enviado');
      expect(r.attempts).toBe(1);
      expect(r.sent_at).not.toBeNull();
    }
  });

  it('recovers a stuck event, cancels closed-task and 24h-late reminders, and sends only the live one', async () => {
    const u = await mkUser();
    const live = await mkReminder(u.id, await mkTask(u.id, 'viva'), at(-10));
    const closed = await mkReminder(u.id, await mkTask(u.id, 'encerrada', 'concluida'), at(-10));
    const late = await mkReminder(u.id, await mkTask(u.id, 'atrasada'), at(-25 * 60));

    const eventId = randomUUID();
    await pool.query(
      `insert into public.inbound_events (id, channel, external_id, user_id, status, received_at, attempt_count)
       values ($1, 'telegram', $2, $3, 'processando', $4, 1)`,
      [eventId, `upd-${randomUUID()}`, u.id, at(-10)],
    );
    await pool.query(`insert into public.assistant_model_calls (user_id, channel, called_at) values ($1, 'telegram', $2)`, [
      u.id,
      at(-10),
    ]);
    const neverCalled = randomUUID();
    await pool.query(
      `insert into public.inbound_events (id, channel, external_id, user_id, status, received_at, attempt_count)
       values ($1, 'telegram', $2, $3, 'recebido', $4, 0)`,
      [neverCalled, `upd-${randomUUID()}`, u.id, at(-10)],
    );

    const tg = fakeTelegram();
    const res = await tick(withTelegram(tg.client));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reminders: { sent: number; cancelled: number }; eventsRecovered: unknown };
    expect(body.eventsRecovered).toEqual({ recovered: 1, failed: 1 });
    expect(body.reminders.sent).toBe(1);
    expect(body.reminders.cancelled).toBe(2);

    const ev = (await pool.query(`select status, reply, processed_at from public.inbound_events where id = $1`, [eventId]))
      .rows[0];
    expect(ev.status).toBe('processado');
    expect(ev.reply).toEqual({
      reply: 'Sua mensagem pode ter sido processada só em parte. Confira suas tarefas e envie de novo o que faltar.',
      affectedTasks: [],
    });
    expect(
      (await pool.query(`select status from public.inbound_events where id = $1`, [neverCalled])).rows[0].status,
    ).toBe('falhou');

    expect((await reminder(live)).status).toBe('enviado');
    expect((await reminder(closed)).status).toBe('cancelado');
    expect((await reminder(late)).status).toBe('cancelado');
    expect(tg.sent.filter((m) => m.chatId === u.chat).map((m) => m.text.includes('viva'))).toEqual([true]);
  });

  it('without a Telegram client: 200, recovery and cancellation run, nothing is claimed or sent', async () => {
    const u = await mkUser();
    const due = await mkReminder(u.id, await mkTask(u.id, 'pendente-sem-bot'), at(-10));
    const closed = await mkReminder(u.id, await mkTask(u.id, 'encerrada-sem-bot', 'cancelada'), at(-10));
    const eventId = randomUUID();
    await pool.query(
      `insert into public.inbound_events (id, channel, external_id, user_id, status, received_at, attempt_count)
       values ($1, 'telegram', $2, $3, 'processando', $4, 1)`,
      [eventId, `upd-${randomUUID()}`, u.id, at(-10)],
    );

    const res = await tick(withoutTelegram());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      reminders: { sent: number };
      briefings: { sent: number };
      eventsRecovered: { recovered: number };
    };
    expect(body.reminders.sent).toBe(0);
    expect(body.briefings.sent).toBe(0);
    expect(body.eventsRecovered.recovered).toBe(1);

    const r = await reminder(due);
    expect(r.status).toBe('pendente');
    expect(r.attempts).toBe(0);
    expect((await reminder(closed)).status).toBe('cancelado');
    expect(
      (await pool.query(`select status from public.inbound_events where id = $1`, [eventId])).rows[0].status,
    ).toBe('processado');
  });

  it('answers 401 for a wrong secret and 503 when the config has no secret, without touching the database', async () => {
    const u = await mkUser();
    const due = await mkReminder(u.id, await mkTask(u.id, 'intocada'), at(-10));
    const tg = fakeTelegram();
    const app = withTelegram(tg.client);
    const wrong = await app.request('/internal/reminders/run', { method: 'POST', headers: { 'X-Internal-Secret': 'x' } });
    expect(wrong.status).toBe(401);
    const noSecret = buildApp(baseConfig, { clock, telegramClient: tg.client });
    expect((await tick(noSecret)).status).toBe(503);
    expect((await reminder(due)).status).toBe('pendente');
    expect(tg.sent).toEqual([]);
  });
});
