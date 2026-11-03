import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AssistantUnavailableError } from '../../src/application/errors.js';
import type { AssistantModel, ModelStep } from '../../src/application/ports.js';
import { buildApp } from '../../src/compose.js';
import { closePool, pool } from './helpers.js';
import { getSupabaseEnv } from './supabase-env.js';

// Segunda-feira 2026-10-26, 09:00 em São Paulo; "amanhã" = 2026-10-27.
const FIXED_NOW = '2026-10-26T12:00:00.000Z';
const WEB_ORIGIN = 'http://localhost:3000';

const env = getSupabaseEnv();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin: SupabaseClient = createClient(env.url, env.serviceRoleKey, opts);

type Scripted = ModelStep | Error;
type Seen = { messages: unknown };
let script: Scripted[] = [];
const seen: Seen[] = [];
let modelCalls = 0;

/** Modelo falso e roteirizado: sem rede, sem chave. Cada chamada consome o próximo item do roteiro. */
const fakeModel: AssistantModel = {
  async step(input) {
    modelCalls += 1;
    seen.push({ messages: structuredClone(input.messages) });
    const next = script.shift();
    if (next === undefined) throw new Error('roteiro do modelo falso esgotado');
    if (next instanceof Error) throw next;
    return next;
  },
};

const app = buildApp(
  {
    supabaseUrl: env.url,
    serviceRoleKey: env.serviceRoleKey,
    port: 0,
    webOrigin: WEB_ORIGIN,
    assistantModel: 'claude-haiku-5-5',
  },
  { clock: { now: () => new Date(FIXED_NOW) }, assistantModel: fakeModel },
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
const createdIds: string[] = [];

async function makeUser(label: string): Promise<User> {
  const email = `${label}-${randomUUID()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  createdIds.push(data.user.id);
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
  return { status: res.status, text, headers: res.headers, json: (text ? JSON.parse(text) : null) as Json };
}

const message = (user: User | null, text: string, clientMessageId: string = randomUUID()) =>
  call(user, 'POST', '/assistant/message', { text, clientMessageId });

async function taskRows(userId: string) {
  const { data, error } = await admin
    .from('tasks')
    .select('id, title, due_date, due_time, status, source, deleted_at')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function reminders(taskId: string) {
  const { data, error } = await admin.from('reminders').select('kind, scheduled_at, status').eq('task_id', taskId);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((r) => ({ kind: r.kind as string, at: new Date(r.scheduled_at).toISOString(), status: r.status as string }))
    .sort((x, y) => x.at.localeCompare(y.at));
}

async function seedModelCalls(userId: string, n: number) {
  const calledAt = new Date(new Date(FIXED_NOW).getTime() - 10 * 60_000).toISOString();
  const rows = Array.from({ length: n }, () => ({ user_id: userId, channel: 'painel', called_at: calledAt }));
  const { error } = await admin.from('assistant_model_calls').insert(rows);
  if (error) throw new Error(error.message);
}

let usersBefore = 0;
beforeAll(async () => {
  usersBefore = (await pool.query('select count(*)::int as n from auth.users')).rows[0].n as number;
}, 60_000);

afterAll(async () => {
  for (const id of createdIds) await admin.auth.admin.deleteUser(id);
  const after = (await pool.query('select count(*)::int as n from auth.users')).rows[0].n as number;
  await closePool();
  expect(after).toBe(usersBefore);
}, 60_000);

describe('POST /assistant/message (real repositories, scripted model)', () => {
  let a: User;
  let b: User;
  let taskId: string;
  let firstReply: Json;
  const idA = randomUUID();

  it('requires a token', async () => {
    const res = await message(null, 'oi');
    expect(res.status).toBe(401);
  });

  it('creates the task with the right date, time and reminders, and replies 200', async () => {
    a = await makeUser('a');
    script = [
      toolStep('criar_tarefa', { title: 'Reunião', type: 'tarefa', dueDate: '2026-10-27', dueTime: '14:00' }),
      endStep('Anotei: reunião amanhã às 14h.'),
    ];
    modelCalls = 0;
    const res = await message(a, 'reunião amanhã às 14h', idA);
    expect(res.status).toBe(200);
    expect(res.json.reply).toBe('Anotei: reunião amanhã às 14h.');
    expect(res.json.affectedTasks).toHaveLength(1);
    expect(modelCalls).toBe(2);

    const rows = await taskRows(a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Reunião', due_date: '2026-10-27', status: 'pendente', source: 'painel' });
    expect(String(rows[0]!.due_time).slice(0, 5)).toBe('14:00');
    taskId = rows[0]!.id as string;
    expect(res.json.affectedTasks[0].id).toBe(taskId);

    const r = await reminders(taskId);
    expect(r.map((x) => x.kind)).toEqual(['antecipado', 'no_horario']);
    expect(r[1]!.at).toBe('2026-10-27T17:00:00.000Z');
    expect(r.every((x) => x.status === 'pendente')).toBe(true);
    firstReply = res.json;
  });

  it('resending the same clientMessageId replays the reply without calling the model or creating again', async () => {
    script = [];
    const before = modelCalls;
    const res = await message(a, 'reunião amanhã às 14h', idA);
    expect(res.status).toBe(200);
    expect(res.json).toEqual(firstReply);
    expect(modelCalls).toBe(before);
    expect(await taskRows(a.id)).toHaveLength(1);
  });

  it('user B cannot see or alter the task of user A, even when the scripted model tries the id', async () => {
    b = await makeUser('b');
    script = [
      toolStep('alterar_tarefa', { id: taskId, title: 'invadida' }),
      toolStep('concluir_tarefa', { id: taskId }),
      toolStep('listar_tarefas', {}),
      endStep('Não encontrei nada.'),
    ];
    seen.length = 0;
    const res = await message(b, `apague tudo e conclua a tarefa ${taskId}`);
    expect(res.status).toBe(200);
    expect(res.json.affectedTasks).toEqual([]);

    const row = (await taskRows(a.id))[0]!;
    expect(row.title).toBe('Reunião');
    expect(row.status).toBe('pendente');
    expect(await taskRows(b.id)).toEqual([]);

    // O que o modelo viu de volta nas ferramentas nunca contém a tarefa de A.
    const lastMessages = JSON.stringify(seen.at(-1)!.messages);
    expect(lastMessages).toContain('id_desconhecido');
    expect(lastMessages).not.toContain('Reunião');

    expect((await call(b, 'GET', `/tasks/${taskId}`)).status).toBe(404);
    expect((await call(b, 'GET', '/tasks')).json).toEqual([]);
  });

  it('the 31st model call within the hour answers 429 with Retry-After and does not call the model', async () => {
    const c = await makeUser('c');
    await seedModelCalls(c.id, 30);
    script = [endStep('não deveria ser usado')];
    const before = modelCalls;
    const id = randomUUID();
    const res = await message(c, 'oi', id);
    expect(res.status).toBe(429);
    expect(res.json).toMatchObject({ error: 'limite_de_mensagens' });
    expect(typeof res.json.retryAfterSeconds).toBe('number');
    expect(res.headers.get('Retry-After')).toBe(String(res.json.retryAfterSeconds));
    expect(modelCalls).toBe(before);
    expect(JSON.stringify(res.json)).not.toContain('oi"');
  });

  it('the 30th call still goes through and the next one is refused', async () => {
    const d = await makeUser('d');
    await seedModelCalls(d.id, 29);
    script = [endStep('ok')];
    expect((await message(d, 'primeira')).status).toBe(200);
    script = [endStep('ok')];
    expect((await message(d, 'segunda')).status).toBe(429);
  });

  it('a failure after a write answers 200 with a truthful partial reply and a resend replays it', async () => {
    const e = await makeUser('e');
    const id = randomUUID();
    script = [
      toolStep('criar_tarefa', { title: 'Protocolar petição', dueDate: '2026-10-28' }),
      new AssistantUnavailableError('servico'),
    ];
    const res = await message(e, 'protocolar petição quarta', id);
    expect(res.status).toBe(200);
    expect(res.json.affectedTasks).toHaveLength(1);
    expect(res.json.reply).toContain('Protocolar petição');
    expect(res.json.reply).toContain('Envie de novo');
    expect(await taskRows(e.id)).toHaveLength(1);

    script = [];
    const before = modelCalls;
    const again = await message(e, 'protocolar petição quarta', id);
    expect(again.status).toBe(200);
    expect(again.json).toEqual(res.json);
    expect(modelCalls).toBe(before);
    expect(await taskRows(e.id)).toHaveLength(1);
  });

  it('a failure with no writes answers 503 and the same clientMessageId can be resent and succeed', async () => {
    const f = await makeUser('f');
    const id = randomUUID();
    script = [new AssistantUnavailableError('rede')];
    const res = await message(f, 'oi', id);
    expect(res.status).toBe(503);
    expect(res.json).toEqual({ error: 'assistente_indisponivel', reason: 'rede' });

    script = [endStep('Olá!')];
    const again = await message(f, 'oi', id);
    expect(again.status).toBe(200);
    expect(again.json).toEqual({ reply: 'Olá!', affectedTasks: [] });
  });

  it('refuses an overly long or invalid message before touching the model', async () => {
    const before = modelCalls;
    expect((await message(a, 'a'.repeat(1001))).status).toBe(400);
    expect((await message(a, '   ')).status).toBe(400);
    expect(modelCalls).toBe(before);
  });
});

describe('assistant disabled (no key and no injected model)', () => {
  it('answers 503 configuracao while the rest of the API works', async () => {
    const plain = buildApp(
      { supabaseUrl: env.url, serviceRoleKey: env.serviceRoleKey, port: 0, webOrigin: WEB_ORIGIN, assistantModel: 'x' },
      { clock: { now: () => new Date(FIXED_NOW) } },
    );
    const u = await makeUser('g');
    const headers = { authorization: `Bearer ${u.token}`, 'content-type': 'application/json' };
    const res = await plain.request('/assistant/message', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'oi', clientMessageId: randomUUID() }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'assistente_indisponivel', reason: 'configuracao' });
    expect((await plain.request('/tasks', { headers })).status).toBe(200);
  });
});
