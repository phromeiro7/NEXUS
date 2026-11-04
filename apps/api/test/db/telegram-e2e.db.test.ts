import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantModel, ModelStep, TelegramClient } from '../../src/application/ports.js';
import { buildApp } from '../../src/compose.js';
import { createFakes } from '../fakes.js';
import { closePool, deleteCreatedUsers, pool } from './helpers.js';
import { getSupabaseEnv } from './supabase-env.js';

// Relógio fixo e longe de qualquer outro teste. Quarta-feira 2033-03-09, 09:00 em São Paulo
// (sem horário de verão em 2033); "amanhã" = quinta 2033-03-10. O relógio é mutável: a jornada o avança.
let nowMs = Date.parse('2033-03-09T12:00:00.000Z');
const clock = { now: () => new Date(nowMs) };
const setNow = (iso: string) => {
  nowMs = Date.parse(iso);
};

const WEBHOOK_SECRET = 'TEST_WEBHOOK_SECRET';
const INTERNAL_SECRET = 'TEST_INTERNAL_SECRET';
const HEADER = 'X-Telegram-Bot-Api-Secret-Token';

const env = getSupabaseEnv();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin: SupabaseClient = createClient(env.url, env.serviceRoleKey, opts);

// Modelo falso roteirizado.
type Scripted = ModelStep | Error;
let script: Scripted[] = [];
const modelCalls: Array<{ messages: unknown }> = [];
const fakeModel: AssistantModel = {
  async step(input) {
    modelCalls.push({ messages: structuredClone(input.messages) });
    const next = script.shift();
    if (next === undefined) throw new Error('roteiro do modelo falso esgotado');
    if (next instanceof Error) throw next;
    return next;
  },
};
const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 };
const toolStep = (name: string, input: unknown): ModelStep => ({
  stopReason: 'tool_use',
  blocks: [{ type: 'tool_use', id: `toolu_${randomUUID().slice(0, 8)}`, name, input }],
  usage,
});
const endStep = (text: string): ModelStep => ({ stopReason: 'end_turn', blocks: [{ type: 'text', text }], usage });

// Telegram falso (registra tudo); a demora artificial faz execuções simultâneas se sobreporem. Sem
// o bloqueio da reserva, 8 execuções simultâneas reservam o mesmo lembrete na maioria das vezes (3 não bastavam).

const fakes = createFakes();
const telegram = fakes.telegram;
const slowTelegram: TelegramClient = {
  async sendMessage(chatId, text, options) {
    await new Promise((r) => setTimeout(r, 100));
    return telegram.sendMessage(chatId, text, options);
  },
  editMessageText: (...args) => telegram.editMessageText(...args),
  answerCallbackQuery: (...args) => telegram.answerCallbackQuery(...args),
};

const app = buildApp(
  {
    supabaseUrl: env.url,
    serviceRoleKey: env.serviceRoleKey,
    port: 0,
    webOrigin: 'http://localhost:3000',
    assistantModel: 'x',
    telegramBotUsername: 'meu_bot',
    telegramWebhookSecret: WEBHOOK_SECRET,
    internalSecret: INTERNAL_SECRET,
  },
  { clock, assistantModel: fakeModel, telegramClient: slowTelegram },
);

type User = { id: string; token: string; email: string };
const password = `pw-${randomUUID()}`;
const authUserIds: string[] = [];

async function makeUser(label: string): Promise<User> {
  const email = `${label}-${randomUUID()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  authUserIds.push(data.user.id);
  // briefing_time fora da janela dos relógios usados aqui: o briefing não interfere.
  await pool.query(`update public.profiles set briefing_time = '23:00' where id = $1`, [data.user.id]);
  const anon = createClient(env.url, env.anonKey, opts);
  const { data: s, error: e2 } = await anon.auth.signInWithPassword({ email, password });
  if (e2 || !s.session) throw new Error(`signIn: ${e2?.message}`);
  return { id: data.user.id, token: s.session.access_token, email };
}

// biome-ignore lint/suspicious/noExplicitAny: JSON bodies are inspected loosely in tests
type Json = any;
async function call(user: User, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${user.token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as Json };
}

let updateSeq = 6_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
let chatSeq = 8_700_000_000 + Math.floor(Math.random() * 1_000_000_000);
const newChat = () => chatSeq++;
const update = (chatId: number, extra: Record<string, unknown>) => ({
  update_id: updateSeq++,
  message: { message_id: 10, date: 1, chat: { id: chatId, type: 'private' }, ...extra },
});
const hook = async (body: unknown, secret: string | null = WEBHOOK_SECRET) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers[HEADER] = secret;
  const res = await app.request('/telegram/webhook', { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
};
const tick = (secret: string | null = INTERNAL_SECRET) =>
  app.request('/internal/reminders/run', {
    method: 'POST',
    headers: secret === null ? {} : { 'X-Internal-Secret': secret },
  });

const sentTo = (chatId: number) => telegram.sent.filter((s) => s.chatId === chatId).map((s) => s.text);

type ReminderRow = { kind: string; status: string; scheduled_at: string; attempts: number };
async function remindersOf(taskId: string): Promise<ReminderRow[]> {
  const { rows } = await pool.query(
    `select kind, status, to_char(scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as scheduled_at, attempts
       from public.reminders where task_id = $1 order by scheduled_at, kind`,
    [taskId],
  );
  return rows as ReminderRow[];
}
const tasksOf = async (userId: string) =>
  (await pool.query(`select id, title, due_date::text as due_date, due_time::text as due_time, status, source
                       from public.tasks where user_id = $1 and deleted_at is null`, [userId])).rows as Array<{
    id: string;
    title: string;
    due_date: string;
    due_time: string | null;
    status: string;
    source: string;
  }>;

afterAll(async () => {
  for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
  await deleteCreatedUsers();
  await closePool();
}, 60_000);

describe('journey: link -> create by message -> reschedule by reply -> reminder sent once -> complete', () => {
  let user: User;
  let chat: number;
  let taskId: string;
  const CONFIRMATION_ID = 555_001;

  it('generates a code and /start CODE links the chat', async () => {
    user = await makeUser('e2e');
    const gen = await call(user, 'POST', '/telegram/link-codes');
    expect(gen.status).toBe(200);
    expect(gen.json.expiresAt).toBe('2033-03-09T12:10:00.000Z');
    chat = newChat();
    expect((await hook(update(chat, { text: `/start ${gen.json.code}` }))).status).toBe(200);
    expect(sentTo(chat)).toEqual([
      `Conta vinculada: ${user.email[0]}***@example.test. Você receberá lembretes e o briefing do dia aqui. Se você não reconhece esta conta, envie /desvincular agora.`,
    ]);
    const { rows } = await pool.query('select telegram_chat_id, channel_paused from public.profiles where id = $1', [user.id]);
    expect(Number(rows[0].telegram_chat_id)).toBe(chat);
    expect(rows[0].channel_paused).toBe(false);
  });

  it('"reunião amanhã às 14h" creates the task and its two reminders (15 min early + on time)', async () => {
    script = [
      toolStep('criar_tarefa', { title: 'Reunião', type: 'tarefa', dueDate: '2033-03-10', dueTime: '14:00' }),
      endStep('Anotei: reunião amanhã às 14h.'),
    ];
    telegram.script({ ok: true, messageId: CONFIRMATION_ID });
    expect((await hook(update(chat, { text: 'pode marcar reunião amanhã às 14h?' }))).status).toBe(200);
    expect(sentTo(chat).at(-1)).toBe('Anotei: reunião amanhã às 14h.\n\n• Reunião — qui, 10/03, 14:00');

    const tasks = await tasksOf(user.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: 'Reunião',
      due_date: '2033-03-10',
      due_time: '14:00:00',
      status: 'pendente',
      source: 'telegram',
    });
    taskId = tasks[0]!.id;
    // 14:00 em São Paulo (UTC-3) = 17:00Z; o antecipado sai 15 min antes.
    expect(await remindersOf(taskId)).toEqual([
      { kind: 'antecipado', status: 'pendente', scheduled_at: '2033-03-10T16:45:00Z', attempts: 0 },
      { kind: 'no_horario', status: 'pendente', scheduled_at: '2033-03-10T17:00:00Z', attempts: 0 },
    ]);
  });

  it('a reply to the bot confirmation ("muda para 16h") alters THAT task and rebuilds its reminders', async () => {
    script = [toolStep('alterar_tarefa', { id: taskId, dueTime: '16:00' }), endStep('Mudei para 16h.')];
    modelCalls.length = 0;
    const res = await hook(update(chat, { text: 'muda para 16h', reply_to_message: { message_id: CONFIRMATION_ID } }));
    expect(res.status).toBe(200);
    expect(JSON.stringify(modelCalls[0]!.messages)).toContain(taskId);

    const tasks = await tasksOf(user.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: taskId, due_date: '2033-03-10', due_time: '16:00:00' });
    expect((await remindersOf(taskId)).filter((r) => r.status === 'pendente')).toEqual([
      { kind: 'antecipado', status: 'pendente', scheduled_at: '2033-03-10T18:45:00Z', attempts: 0 },
      { kind: 'no_horario', status: 'pendente', scheduled_at: '2033-03-10T19:00:00Z', attempts: 0 },
    ]);
  });

  it('eight SIMULTANEOUS scheduler calls at the early time send the new-time reminder exactly once', async () => {
    setNow('2033-03-10T18:46:00.000Z'); // 15:46 local: antecipado venceu há 1 min; no_horario ainda não
    const before = telegram.sent.length;
    const results = await Promise.all(Array.from({ length: 8 }, () => tick()));
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
    const sentCounts = await Promise.all(
      results.map(async (r) => ((await r.json()) as { reminders: { sent: number } }).reminders.sent),
    );
    expect(sentCounts.reduce((x, y) => x + y, 0)).toBe(1);

    expect(telegram.sent.slice(before)).toEqual([{ chatId: chat, text: 'Tarefa às 16:00 (em breve): Reunião' }]);
    const rows = await remindersOf(taskId);
    expect(rows.find((r) => r.kind === 'antecipado')).toMatchObject({ status: 'enviado', attempts: 1 });
    expect(rows.find((r) => r.kind === 'no_horario')).toMatchObject({ status: 'pendente', attempts: 0 });

    // Uma terceira chamada, depois, também não repete nada.
    expect((await tick()).status).toBe(200);
    expect(telegram.sent.slice(before)).toHaveLength(1);
  });

  it('completing the task removes the pending reminder (replacePending with none): nothing more is sent', async () => {
    const done = await call(user, 'PATCH', `/tasks/${taskId}`, { status: 'concluida' });
    expect(done.status).toBe(200);
    setNow('2033-03-10T19:01:00.000Z'); // 16:01 local: o no_horario já venceu
    const before = telegram.sent.length;
    expect((await tick()).status).toBe(200);
    expect(telegram.sent.length).toBe(before);
    const rows = await remindersOf(taskId);
    // Concluir apaga os lembretes pendentes na hora (não sobra 'pendente' para o agendador enviar);
    // o histórico do já enviado fica. O caminho 'cancelado' no envio está em scheduler.db.test.ts.
    expect(rows).toEqual([{ kind: 'antecipado', status: 'enviado', scheduled_at: '2033-03-10T18:45:00Z', attempts: 1 }]);
  });
});

describe('failure paths end to end', () => {
  it('a wrong or missing webhook secret answers 401 and has no effect; the scheduler secret too', async () => {
    setNow('2033-03-09T12:00:00.000Z');
    const u = await makeUser('secret');
    const code = (await call(u, 'POST', '/telegram/link-codes')).json.code as string;
    const chat = newChat();
    const before = telegram.sent.length;
    expect((await hook(update(chat, { text: `/start ${code}` }), 'errado')).status).toBe(401);
    expect((await hook(update(chat, { text: `/start ${code}` }), null)).status).toBe(401);
    expect(telegram.sent.length).toBe(before);
    const { rows } = await pool.query('select telegram_chat_id from public.profiles where id = $1', [u.id]);
    expect(rows[0].telegram_chat_id).toBeNull();
    expect((await pool.query('select code from public.link_codes where user_id = $1', [u.id])).rows).toEqual([{ code }]);
    expect((await pool.query(`select 1 from public.inbound_events where channel = 'telegram' and user_id = $1`, [u.id])).rows).toEqual([]);

    expect((await tick('errado')).status).toBe(401);
    expect((await tick(null)).status).toBe(401);
    expect(telegram.sent.length).toBe(before);
  });

  it('a duplicate update_id does not create a second task nor call the model again', async () => {
    setNow('2033-03-09T12:00:00.000Z');
    const u = await makeUser('dup');
    const chat = newChat();
    const code = (await call(u, 'POST', '/telegram/link-codes')).json.code as string;
    await hook(update(chat, { text: `/start ${code}` }));

    script = [
      toolStep('criar_tarefa', { title: 'Duplicada', type: 'tarefa', dueDate: '2033-03-30' }),
      endStep('Anotado.'),
    ];
    const msg = update(chat, { text: 'duplicada para o dia 30?' });
    modelCalls.length = 0;
    expect((await hook(msg)).status).toBe(200);
    expect(modelCalls).toHaveLength(2);
    const afterFirst = sentTo(chat).length;
    expect((await hook(msg)).status).toBe(200);
    expect(modelCalls).toHaveLength(2);
    expect(await tasksOf(u.id)).toHaveLength(1);
    // O reenvio do Telegram recebe a mesma resposta, sem efeito novo.
    const replies = sentTo(chat).slice(afterFirst);
    expect(replies).toEqual([sentTo(chat)[afterFirst - 1]]);
    expect(
      (await pool.query(`select count(*)::int as n from public.inbound_events where channel = 'telegram' and user_id = $1 and external_id = $2`, [u.id, String(msg.update_id)])).rows[0].n,
    ).toBe(1);
  });
});
