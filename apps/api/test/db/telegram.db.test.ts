import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { LinkCodeCollisionError } from '../../src/application/errors.js';
import type { AssistantModel, ModelStep } from '../../src/application/ports.js';
import { buildApp } from '../../src/compose.js';
import { createSupabaseLinkRepository } from '../../src/infra/supabase-link-repository.js';
import { createFakes } from '../fakes.js';
import { closePool, createUser, deleteCreatedUsers, pool } from './helpers.js';
import { getSupabaseEnv } from './supabase-env.js';

// Segunda-feira 2026-10-26, 09:00 em São Paulo; "amanhã" = 2026-10-27.
const FIXED_NOW = '2026-10-26T12:00:00.000Z';
const WEB_ORIGIN = 'http://localhost:3000';
const SECRET = 'TEST_WEBHOOK_SECRET';
const HEADER = 'X-Telegram-Bot-Api-Secret-Token';

const env = getSupabaseEnv();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin: SupabaseClient = createClient(env.url, env.serviceRoleKey, opts);

type Scripted = ModelStep | Error;
let script: Scripted[] = [];
const seen: Array<{ messages: unknown }> = [];
const fakeModel: AssistantModel = {
  async step(input) {
    seen.push({ messages: structuredClone(input.messages) });
    const next = script.shift();
    if (next === undefined) throw new Error('roteiro do modelo falso esgotado');
    if (next instanceof Error) throw next;
    return next;
  },
};

const fakes = createFakes();
const telegram = fakes.telegram;

const app = buildApp(
  {
    supabaseUrl: env.url,
    serviceRoleKey: env.serviceRoleKey,
    port: 0,
    webOrigin: WEB_ORIGIN,
    assistantModel: 'x',
    telegramBotUsername: 'meu_bot',
    telegramWebhookSecret: SECRET,
  },
  { clock: { now: () => new Date(FIXED_NOW) }, assistantModel: fakeModel, telegramClient: telegram },
);

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 };
const toolStep = (name: string, input: unknown): ModelStep => ({
  stopReason: 'tool_use',
  blocks: [{ type: 'tool_use', id: `toolu_${randomUUID().slice(0, 8)}`, name, input }],
  usage,
});
const endStep = (text: string): ModelStep => ({ stopReason: 'end_turn', blocks: [{ type: 'text', text }], usage });

type User = { id: string; token: string };
const password = `pw-${randomUUID()}`;
const authUserIds: string[] = [];

async function makeUser(label: string): Promise<User> {
  const email = `${label}-${randomUUID()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  authUserIds.push(data.user.id);
  const anon = createClient(env.url, env.anonKey, opts);
  const { data: s, error: e2 } = await anon.auth.signInWithPassword({ email, password });
  if (e2 || !s.session) throw new Error(`signIn: ${e2?.message}`);
  return { id: data.user.id, token: s.session.access_token };
}

// biome-ignore lint/suspicious/noExplicitAny: JSON bodies are inspected loosely in tests
type Json = any;

async function call(user: User | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, json: (text ? JSON.parse(text) : null) as Json };
}

// update_id e chat ids únicos por execução (inbound_events é único por (canal, id externo)).
let updateSeq = 7_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
let chatSeq = 8_300_000_000 + Math.floor(Math.random() * 1_000_000_000);
const newChat = () => chatSeq++;

function update(chatId: number, extra: Record<string, unknown>, over: { type?: string } = {}) {
  return {
    update_id: updateSeq++,
    message: {
      message_id: 10,
      date: 1,
      chat: { id: chatId, type: over.type ?? 'private' },
      ...extra,
    },
  };
}

const hook = async (body: unknown, secret: string | null = SECRET) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers[HEADER] = secret;
  const res = await app.request('/telegram/webhook', { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
};

const sentTo = (chatId: number) => telegram.sent.filter((s) => s.chatId === chatId).map((s) => s.text);

async function profileOf(userId: string) {
  const { rows } = await pool.query('select telegram_chat_id from public.profiles where id = $1', [userId]);
  return rows[0] as { telegram_chat_id: string | null };
}
const codeRows = async (userId: string) =>
  (await pool.query('select code from public.link_codes where user_id = $1', [userId])).rows as Array<{ code: string }>;
async function taskRows(userId: string) {
  const { data, error } = await admin
    .from('tasks')
    .select('id, title, due_date, due_time, source')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return data ?? [];
}
const confirmationRows = async (chatId: number) =>
  (await pool.query('select message_id, task_id from public.task_confirmations where chat_id = $1', [chatId]))
    .rows as Array<{ message_id: string; task_id: string }>;

afterAll(async () => {
  for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
  await deleteCreatedUsers();
  await closePool();
}, 60_000);

describe('Telegram link flow and webhook (real repositories, scripted model, fake Telegram)', () => {
  let a: User;
  let chatA: number;
  let taskId: string;
  const CONFIRMATION_ID = 424_242;

  it('POST /telegram/link-codes requires a token and returns a code that is stored', async () => {
    expect((await call(null, 'POST', '/telegram/link-codes')).status).toBe(401);
    a = await makeUser('a');
    const res = await call(a, 'POST', '/telegram/link-codes');
    expect(res.status).toBe(200);
    expect(res.json.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(res.json.deepLink).toBe(`https://t.me/meu_bot?start=${res.json.code}`);
    expect(res.json.expiresAt).toBe('2026-10-26T12:10:00.000Z');
    expect((await codeRows(a.id)).map((r) => r.code)).toEqual([res.json.code]);
  });

  it('a new code replaces the previous one', async () => {
    const before = (await codeRows(a.id))[0]!.code;
    const res = await call(a, 'POST', '/telegram/link-codes');
    const rows = await codeRows(a.id);
    expect(rows).toEqual([{ code: res.json.code }]);
    expect(res.json.code).not.toBe(before);
  });

  it('a wrong secret answers 401 and nothing happens; a missing header too', async () => {
    const code = (await codeRows(a.id))[0]!.code;
    const chat = newChat();
    const sentBefore = telegram.sent.length;
    expect((await hook(update(chat, { text: `/start ${code}` }), 'errado')).status).toBe(401);
    expect((await hook(update(chat, { text: `/start ${code}` }), null)).status).toBe(401);
    expect(telegram.sent.length).toBe(sentBefore);
    expect((await profileOf(a.id)).telegram_chat_id).toBeNull();
    expect((await codeRows(a.id)).map((r) => r.code)).toEqual([code]);
  });

  it('a group update is ignored (200, no reply, nothing linked)', async () => {
    const code = (await codeRows(a.id))[0]!.code;
    const chat = newChat();
    const res = await hook(update(chat, { text: `/start ${code}` }, { type: 'group' }));
    expect(res.status).toBe(200);
    expect(sentTo(chat)).toEqual([]);
    expect((await profileOf(a.id)).telegram_chat_id).toBeNull();
  });

  it('webhook /start CODE links the chat and consumes the code', async () => {
    const code = (await codeRows(a.id))[0]!.code;
    chatA = newChat();
    const res = await hook(update(chatA, { text: `/start ${code}` }));
    expect(res.status).toBe(200);
    expect(sentTo(chatA)).toEqual([
      'Conta vinculada! Você receberá lembretes e o briefing do dia aqui. Se não foi você quem gerou o código no painel, envie /desvincular.',
    ]);
    expect(Number((await profileOf(a.id)).telegram_chat_id)).toBe(chatA);
    expect(await codeRows(a.id)).toEqual([]);
    expect((await call(a, 'GET', '/settings')).json).toMatchObject({ telegramLinked: true, channelPaused: false });
  });

  it('a message creates the task through the scripted model and records the confirmation with the SENT message id', async () => {
    script = [
      toolStep('criar_tarefa', { title: 'Reunião', type: 'tarefa', dueDate: '2026-10-27', dueTime: '14:00' }),
      endStep('Anotei: reunião amanhã às 14h.'),
    ];
    telegram.script({ ok: true, messageId: CONFIRMATION_ID });
    const res = await hook(update(chatA, { text: 'reunião amanhã às 14h' }));
    expect(res.status).toBe(200);
    expect(sentTo(chatA).at(-1)).toBe('Anotei: reunião amanhã às 14h.\n\n• Reunião — ter, 27/10, 14:00');
    const rows = await taskRows(a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Reunião', due_date: '2026-10-27', source: 'telegram' });
    taskId = rows[0]!.id as string;
    const conf = await confirmationRows(chatA);
    expect(conf.map((c) => [Number(c.message_id), c.task_id])).toEqual([[CONFIRMATION_ID, taskId]]);
  });

  it('a duplicate update_id replays the reply without creating a second task', async () => {
    script = [];
    const dup = update(chatA, { text: 'outra coisa' });
    script = [endStep('Certo.')];
    await hook(dup);
    const before = seen.length;
    await hook(dup);
    expect(seen.length).toBe(before);
    expect(await taskRows(a.id)).toHaveLength(1);
  });

  it('a reply to that confirmation reaches the model with the target task and alters THAT task', async () => {
    script = [toolStep('alterar_tarefa', { id: taskId, dueTime: '15:30' }), endStep('Mudei para 15h30.')];
    seen.length = 0;
    const res = await hook(
      update(chatA, { text: 'muda para 15h30', reply_to_message: { message_id: CONFIRMATION_ID } }),
    );
    expect(res.status).toBe(200);
    expect(JSON.stringify(seen[0]!.messages)).toContain(taskId);
    const [row] = await taskRows(a.id);
    expect(String(row!.due_time).slice(0, 5)).toBe('15:30');
    expect(await taskRows(a.id)).toHaveLength(1);
  });

  it('a reply to the confirmation of a DELETED task says it no longer exists and does not call the model', async () => {
    await pool.query('update public.tasks set deleted_at = now() where id = $1', [taskId]);
    script = [];
    seen.length = 0;
    await hook(update(chatA, { text: 'muda para 16h', reply_to_message: { message_id: CONFIRMATION_ID } }));
    expect(sentTo(chatA).at(-1)).toBe('Essa tarefa não existe mais.');
    expect(seen).toHaveLength(0);
  });

  it('an unlinked chat only gets guidance: no model call, no task', async () => {
    const stranger = newChat();
    seen.length = 0;
    await hook(update(stranger, { text: 'reunião amanhã' }));
    expect(sentTo(stranger)).toEqual([
      'Esta conta ainda não está vinculada. Gere um código no painel (Configurações) e envie /start CÓDIGO.',
    ]);
    expect(seen).toHaveLength(0);
  });

  it('a second user cannot link a chat already linked to another account, and the code stays valid', async () => {
    const b = await makeUser('b');
    const code = (await call(b, 'POST', '/telegram/link-codes')).json.code as string;
    await hook(update(chatA, { text: `/start ${code}` }));
    expect(sentTo(chatA).at(-1)).toBe('Este Telegram já está ligado a outra conta.');
    expect((await profileOf(b.id)).telegram_chat_id).toBeNull();
    expect((await codeRows(b.id)).map((r) => r.code)).toEqual([code]);
    expect(Number((await profileOf(a.id)).telegram_chat_id)).toBe(chatA);
    // O mesmo código ainda vincula um chat livre.
    const free = newChat();
    await hook(update(free, { text: `/start ${code}` }));
    expect(Number((await profileOf(b.id)).telegram_chat_id)).toBe(free);
  });

  it('DELETE /telegram/link unlinks (204) and the chat is unlinked again', async () => {
    expect((await call(null, 'DELETE', '/telegram/link')).status).toBe(401);
    const res = await call(a, 'DELETE', '/telegram/link');
    expect(res.status).toBe(204);
    expect((await profileOf(a.id)).telegram_chat_id).toBeNull();
    await hook(update(chatA, { text: 'oi' }));
    expect(sentTo(chatA).at(-1)).toContain('ainda não está vinculada');
  });

  it('/desvincular from a linked chat unlinks it', async () => {
    const c = await makeUser('c');
    const code = (await call(c, 'POST', '/telegram/link-codes')).json.code as string;
    const chat = newChat();
    await hook(update(chat, { text: `/start ${code}` }));
    expect(Number((await profileOf(c.id)).telegram_chat_id)).toBe(chat);
    await hook(update(chat, { text: '/desvincular' }));
    expect(sentTo(chat).at(-1)).toBe('Telegram desvinculado. Você não receberá mais lembretes por aqui.');
    expect((await profileOf(c.id)).telegram_chat_id).toBeNull();
  });

  it('the repository maps a duplicate code to LinkCodeCollisionError', async () => {
    const u1 = await createUser();
    const u2 = await createUser();
    const links = createSupabaseLinkRepository(admin);
    const code = `Z${randomUUID().replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 7)}`;
    await links.create(u1, code, new Date(FIXED_NOW));
    await expect(links.create(u2, code, new Date(FIXED_NOW))).rejects.toBeInstanceOf(LinkCodeCollisionError);
  });
});
