import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/compose.js';
import { closePool, pool } from './helpers.js';
import { getSupabaseEnv } from './supabase-env.js';

const FIXED_NOW = '2026-10-26T12:00:00.000Z';
const WEB_ORIGIN = 'http://localhost:3000';

const env = getSupabaseEnv();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin: SupabaseClient = createClient(env.url, env.serviceRoleKey, opts);
const app = buildApp(
  { supabaseUrl: env.url, serviceRoleKey: env.serviceRoleKey, port: 0, webOrigin: WEB_ORIGIN, assistantModel: 'claude-haiku-5-5' },
  { clock: { now: () => new Date(FIXED_NOW) } },
);

type User = { id: string; token: string };
const password = `pw-${randomUUID()}`;
const createdIds: string[] = [];
let usersBefore = 0;
let a: User;
let b: User;
let c: User;
let d: User;

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

async function countAuthUsers(): Promise<number> {
  const r = await pool.query('select count(*)::int as n from auth.users');
  return r.rows[0].n as number;
}

// biome-ignore lint/suspicious/noExplicitAny: JSON bodies are inspected loosely in tests
type Json = any;

async function call(user: User | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: (text ? JSON.parse(text) : null) as Json };
}

async function reminders(taskId: string) {
  const { data, error } = await admin
    .from('reminders')
    .select('kind, scheduled_at, status')
    .eq('task_id', taskId);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((r) => ({ kind: r.kind as string, at: new Date(r.scheduled_at).toISOString(), status: r.status as string }))
    .sort((x, y) => x.at.localeCompare(y.at));
}

beforeAll(async () => {
  usersBefore = await countAuthUsers();
  a = await makeUser('a');
  b = await makeUser('b');
  c = await makeUser('c');
  d = await makeUser('d');
}, 60_000);

afterAll(async () => {
  for (const id of createdIds) await admin.auth.admin.deleteUser(id);
  await closePool();
}, 60_000);

describe('reminders follow the task (user A)', () => {
  let taskId: string;

  it('creating a fatal task with a due date creates exactly three pending reminders', async () => {
    const res = await call(a, 'POST', '/tasks', { title: 'Contestação', dueDate: '2026-10-30', fatal: true });
    expect(res.status).toBe(201);
    taskId = res.json.id;
    expect(await reminders(taskId)).toEqual([
      { kind: 'tres_dias', at: '2026-10-27T11:00:00.000Z', status: 'pendente' },
      { kind: 'dia_anterior', at: '2026-10-29T11:00:00.000Z', status: 'pendente' },
      { kind: 'no_dia', at: '2026-10-30T11:00:00.000Z', status: 'pendente' },
    ]);
  });

  it('changing the due date replaces the reminders with no leftovers', async () => {
    const res = await call(a, 'PATCH', `/tasks/${taskId}`, { dueDate: '2026-11-04' });
    expect(res.status).toBe(200);
    expect(await reminders(taskId)).toEqual([
      { kind: 'tres_dias', at: '2026-11-01T11:00:00.000Z', status: 'pendente' },
      { kind: 'dia_anterior', at: '2026-11-03T11:00:00.000Z', status: 'pendente' },
      { kind: 'no_dia', at: '2026-11-04T11:00:00.000Z', status: 'pendente' },
    ]);
  });

  it('completing the task removes pending reminders and stamps completedAt with the clock', async () => {
    const res = await call(a, 'PATCH', `/tasks/${taskId}`, { status: 'concluida' });
    expect(res.status).toBe(200);
    expect(res.json.completedAt).toBe(FIXED_NOW);
    expect((await reminders(taskId)).filter((r) => r.status === 'pendente')).toEqual([]);
  });

  it('reopening the task brings the three reminders back and clears completedAt', async () => {
    const res = await call(a, 'PATCH', `/tasks/${taskId}`, { status: 'pendente' });
    expect(res.status).toBe(200);
    expect(res.json.completedAt).toBeNull();
    expect(await reminders(taskId)).toEqual([
      { kind: 'tres_dias', at: '2026-11-01T11:00:00.000Z', status: 'pendente' },
      { kind: 'dia_anterior', at: '2026-11-03T11:00:00.000Z', status: 'pendente' },
      { kind: 'no_dia', at: '2026-11-04T11:00:00.000Z', status: 'pendente' },
    ]);
  });

  it('deleting the task answers 204, hides it, drops reminders and soft-deletes the row', async () => {
    const del = await call(a, 'DELETE', `/tasks/${taskId}`);
    expect(del.status).toBe(204);
    expect(del.text).toBe('');
    const get = await call(a, 'GET', `/tasks/${taskId}`);
    expect(get.status).toBe(404);
    expect(get.json).toEqual({ error: 'nao_encontrado' });
    expect(await reminders(taskId)).toEqual([]);
    const { data } = await admin.from('tasks').select('id, deleted_at').eq('id', taskId);
    expect(data).toHaveLength(1);
    expect(data![0]!.deleted_at).not.toBeNull();
  });
});

describe('tasks with a time and settings changes (user A)', () => {
  it('a task with dueTime returns HH:MM and gets antecipado and no_horario reminders', async () => {
    const res = await call(a, 'POST', '/tasks', {
      title: 'Audiência',
      type: 'audiencia',
      dueDate: '2026-10-27',
      dueTime: '09:00',
    });
    expect(res.status).toBe(201);
    expect(res.json.dueTime).toBe('09:00');
    const get = await call(a, 'GET', `/tasks/${res.json.id}`);
    expect(get.json.dueTime).toBe('09:00');
    expect(await reminders(res.json.id)).toEqual([
      { kind: 'antecipado', at: '2026-10-27T11:45:00.000Z', status: 'pendente' },
      { kind: 'no_horario', at: '2026-10-27T12:00:00.000Z', status: 'pendente' },
    ]);
    hearingId = res.json.id;
  });
  let hearingId: string;

  it('changing earlyReminderMinutes rebuilds reminders of open dated tasks and moves antecipado', async () => {
    const { count } = await admin
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', a.id)
      .is('deleted_at', null)
      .in('status', ['pendente', 'em_andamento'])
      .not('due_date', 'is', null);
    const res = await call(a, 'PATCH', '/settings', { earlyReminderMinutes: 30 });
    expect(res.status).toBe(200);
    expect(res.json.settings.earlyReminderMinutes).toBe(30);
    expect(res.json.remindersSkipped).toBe(0);
    expect(res.json.skipped).toEqual([]);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(res.json.remindersRebuilt).toBe(count);
    expect(await reminders(hearingId)).toEqual([
      { kind: 'antecipado', at: '2026-10-27T11:30:00.000Z', status: 'pendente' },
      { kind: 'no_horario', at: '2026-10-27T12:00:00.000Z', status: 'pendente' },
    ]);
  });
});

describe('impossible local time (user C)', () => {
  it('rejects a nonexistent local time with 422 and creates nothing', async () => {
    const s = await call(c, 'PATCH', '/settings', { timezone: 'America/New_York' });
    expect(s.status).toBe(200);
    expect(s.json).toMatchObject({ remindersRebuilt: 0, remindersSkipped: 0, skipped: [] });
    // 2027-03-01 is a Monday (2027-01-01 is a Friday + 59 days), so the Sundays of
    // March 2027 are 7 and 14: DST starts on the 14th and 02:00-03:00 does not exist.
    // The date is after the fixed clock (2026-10-26).
    const res = await call(c, 'POST', '/tasks', { title: 'x', dueDate: '2027-03-14', dueTime: '02:30' });
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ error: 'hora_invalida', reason: 'hora_inexistente' });
    const list = await call(c, 'GET', '/tasks');
    expect(list.status).toBe(200);
    expect(list.json).toEqual([]);
    const { data } = await admin.from('reminders').select('id').eq('user_id', c.id);
    expect(data).toEqual([]);
    const { data: rows } = await admin.from('tasks').select('id').eq('user_id', c.id);
    expect(rows).toEqual([]);
  });
});

describe('briefing uses the fixed clock and the user day (user A)', () => {
  it('lists overdue and next-two-days tasks of A only', async () => {
    const overdue = await call(a, 'POST', '/tasks', { title: 'Atrasada', dueDate: '2026-10-25' });
    const soon = await call(a, 'POST', '/tasks', { title: 'Amanhã', dueDate: '2026-10-27' });
    const bTask = await call(b, 'POST', '/tasks', { title: 'Do B', dueDate: '2026-10-27' });
    expect(overdue.status).toBe(201);
    expect(soon.status).toBe(201);
    expect(bTask.status).toBe(201);

    const res = await call(a, 'GET', '/briefing');
    expect(res.status).toBe(200);
    expect(res.json.today).toBe('2026-10-26');
    expect(res.json.overdue.map((t: Json) => t.id)).toContain(overdue.json.id);
    expect(res.json.nextTwoDays.map((t: Json) => t.id)).toContain(soon.json.id);
    expect(res.json.overdue.map((t: Json) => t.id)).not.toContain(soon.json.id);
    const all = [...res.json.overdue, ...res.json.fatalToday, ...res.json.hearingsToday, ...res.json.nextTwoDays];
    expect(all.map((t: Json) => t.id)).not.toContain(bTask.json.id);

    const resB = await call(b, 'GET', '/briefing');
    const idsB = [...resB.json.overdue, ...resB.json.nextTwoDays].map((t: Json) => t.id);
    expect(idsB).toContain(bTask.json.id);
    expect(idsB).not.toContain(overdue.json.id);
    expect(idsB).not.toContain(soon.json.id);
  });
});

describe('isolation between users end to end', () => {
  let taskId: string;
  let taskBefore: Json;

  beforeAll(async () => {
    const t = await call(a, 'POST', '/tasks', { title: 'Sigilo de A', dueDate: '2026-12-01' });
    taskId = t.json.id;
    taskBefore = t.json;
  });

  const notFound = { error: 'nao_encontrado' };

  it('B cannot read, change or delete the task of A, which stays unchanged', async () => {
    const get = await call(b, 'GET', `/tasks/${taskId}`);
    expect(get.status).toBe(404);
    expect(get.json).toEqual(notFound);
    const patch = await call(b, 'PATCH', `/tasks/${taskId}`, { title: 'Invadida' });
    expect(patch.status).toBe(404);
    expect(patch.json).toEqual(notFound);
    const del = await call(b, 'DELETE', `/tasks/${taskId}`);
    expect(del.status).toBe(404);
    expect(del.json).toEqual(notFound);
    const after = await call(a, 'GET', `/tasks/${taskId}`);
    expect(after.status).toBe(200);
    expect(after.json).toEqual(taskBefore);
  });

  it('lists and briefing of B contain nothing of A', async () => {
    const tasks = await call(b, 'GET', '/tasks');
    expect(tasks.json.map((t: Json) => t.id)).not.toContain(taskId);
    expect(tasks.json.every((t: Json) => t.title !== 'Sigilo de A')).toBe(true);
    const briefing = await call(b, 'GET', '/briefing');
    expect(JSON.stringify(briefing.json)).not.toContain(taskId);
  });

  it('malformed ids are not found', async () => {
    for (const [method, path] of [
      ['GET', '/tasks/abc'],
    ] as const) {
      const res = await call(a, method, path);
      expect(res.status).toBe(404);
      expect(res.json).toEqual(notFound);
    }
  });

  it('missing and garbage tokens are rejected with 401', async () => {
    expect((await call(null, 'GET', '/tasks')).status).toBe(401);
    const res = await app.request('/tasks', { headers: { authorization: 'Bearer lixo' } });
    expect(res.status).toBe(401);
  });
});

describe('CORS through the real app', () => {
  it('answers the preflight of the web origin without a token', async () => {
    const res = await app.request('/tasks', {
      method: 'OPTIONS',
      headers: { origin: WEB_ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
  });

  it('does not allow another origin', async () => {
    const res = await app.request('/tasks', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('injected clock reaches every consumer (user D, early clock)', () => {
  // Clock 2026-01-05T12:00:00Z, far before the real date, so a consumer wired to the
  // real clock would behave differently on any day. 2026-01-06 is a Tuesday; Sao Paulo
  // is UTC-3, so 08:00 local = 11:00Z and 09:00 local = 12:00Z.
  const earlyApp = buildApp(
    { supabaseUrl: env.url, serviceRoleKey: env.serviceRoleKey, port: 0, webOrigin: WEB_ORIGIN, assistantModel: 'claude-haiku-5-5' },
    { clock: { now: () => new Date('2026-01-05T12:00:00.000Z') } },
  );
  const callEarly = async (method: string, path: string, body?: unknown) => {
    const res = await earlyApp.request(path, {
      method,
      headers: {
        authorization: `Bearer ${d.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Json };
  };
  let dateOnlyId: string;
  let timedId: string;

  it('task use cases keep a future reminder and drop the one already past for the early clock', async () => {
    const res = await callEarly('POST', '/tasks', { title: 'Cedo', dueDate: '2026-01-06' });
    expect(res.status).toBe(201);
    dateOnlyId = res.json.id;
    // dia_anterior would be 2026-01-05T11:00Z, before the 12:00Z clock: must not exist.
    expect(await reminders(dateOnlyId)).toEqual([
      { kind: 'no_dia', at: '2026-01-06T11:00:00.000Z', status: 'pendente' },
    ]);
  });

  it('settings sync uses the injected clock when rebuilding reminders', async () => {
    const res = await callEarly('POST', '/tasks', {
      title: 'Audiência cedo',
      type: 'audiencia',
      dueDate: '2026-01-06',
      dueTime: '09:00',
    });
    expect(res.status).toBe(201);
    timedId = res.json.id;
    const s = await callEarly('PATCH', '/settings', { earlyReminderMinutes: 30 });
    expect(s.status).toBe(200);
    expect(s.json.remindersRebuilt).toBe(2);
    expect(s.json.skipped).toEqual([]);
    // 12:00Z - 30 min. With the real clock this is in the past and would be dropped.
    expect(await reminders(timedId)).toEqual([
      { kind: 'antecipado', at: '2026-01-06T11:30:00.000Z', status: 'pendente' },
      { kind: 'no_horario', at: '2026-01-06T12:00:00.000Z', status: 'pendente' },
    ]);
    expect(await reminders(dateOnlyId)).toEqual([
      { kind: 'no_dia', at: '2026-01-06T11:00:00.000Z', status: 'pendente' },
    ]);
  });

  it('briefing uses the injected clock for today', async () => {
    const res = await callEarly('GET', '/briefing');
    expect(res.status).toBe(200);
    expect(res.json.today).toBe('2026-01-05');
    const ids = res.json.nextTwoDays.map((t: Json) => t.id);
    expect(ids).toContain(dateOnlyId);
    expect(ids).toContain(timedId);
  });
});

describe('cleanup', () => {
  it('removes every user, task and reminder created by this file', async () => {
    for (const id of createdIds) {
      const { error } = await admin.auth.admin.deleteUser(id);
      expect(error).toBeNull();
    }
    expect(await countAuthUsers()).toBe(usersBefore);
    const { data: t } = await admin.from('tasks').select('id').in('user_id', createdIds);
    const { data: r } = await admin.from('reminders').select('id').in('user_id', createdIds);
    expect(t).toEqual([]);
    expect(r).toEqual([]);
  }, 60_000);
});
