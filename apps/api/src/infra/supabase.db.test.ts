import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { getSupabaseEnv } from '../../test/db/supabase-env.js';
import { createSupabaseAuthVerifier } from './supabase-auth.js';
import { makeGetBriefing } from '../application/briefing.js';
import { makeCaptureInterpretUseCases } from '../application/capture-interpret.js';
import { makeFinanceUseCases } from '../application/finance.js';
import { makeSettingsUseCases } from '../application/settings.js';
import { makeSyncReminders } from '../application/sync-reminders.js';
import { makeTaskUseCases } from '../application/tasks.js';
import { makeLinkUseCases } from '../application/telegram/link.js';
import { createSupabaseLinkRepository } from './supabase-link-repository.js';
import { createSupabaseFinanceRepository } from './supabase-finance-repository.js';
import { createSupabaseProfileRepository } from './supabase-profile-repository.js';
import { createSupabaseReminderRepository } from './supabase-reminder-repository.js';
import { createSupabaseTaskRepository } from './supabase-task-repository.js';

const env = getSupabaseEnv();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin: SupabaseClient = createClient(env.url, env.serviceRoleKey, opts);

const password = `pw-${randomUUID()}`;
const users: { a?: { id: string; token: string }; b?: { id: string; token: string } } = {};
const createdIds: string[] = [];

async function makeUser(label: string) {
  const email = `${label}-${randomUUID()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  createdIds.push(data.user.id);
  const anon = createClient(env.url, env.anonKey, opts);
  const { data: s, error: e2 } = await anon.auth.signInWithPassword({ email, password });
  if (e2 || !s.session) throw new Error(`signIn: ${e2?.message}`);
  return { id: data.user.id, token: s.session.access_token };
}

const verifyToken = createSupabaseAuthVerifier(admin);
const taskRepo = createSupabaseTaskRepository(admin);
const profileRepo = createSupabaseProfileRepository(admin);
const reminderRepo = createSupabaseReminderRepository(admin);
const clock = { now: () => new Date() };
const app = createApp({
  verifyToken,
  tasks: makeTaskUseCases({
    tasks: taskRepo,
    profiles: profileRepo,
    reminders: reminderRepo,
    clock,
  }),
  finance: makeFinanceUseCases({ finance: createSupabaseFinanceRepository(admin), clock }),
  capture: makeCaptureInterpretUseCases({ profiles: profileRepo, clock }),
  settings: makeSettingsUseCases({
    profiles: profileRepo,
    tasks: taskRepo,
    syncReminders: makeSyncReminders({ reminders: reminderRepo, clock }),
  }),
  briefing: makeGetBriefing({ tasks: taskRepo, profiles: profileRepo, clock }),
  webOrigin: 'http://localhost:3000',
  telegramLink: makeLinkUseCases({ links: createSupabaseLinkRepository(admin), botUsername: undefined, clock }),
});

const listTasks = (headers: Record<string, string>) => app.request('/tasks', { headers });
const createTask = (token: string, title: string) =>
  app.request('/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title }),
  });

beforeAll(async () => {
  users.a = await makeUser('a');
  users.b = await makeUser('b');
}, 30_000);

afterAll(async () => {
  for (const id of createdIds) await admin.auth.admin.deleteUser(id);
});

describe('Supabase local integration', () => {
  it('auth verifier: real token gives userId, garbage gives null', async () => {
    expect(await verifyToken(users.a!.token)).toEqual({ userId: users.a!.id });
    expect(await verifyToken(users.b!.token)).toEqual({ userId: users.b!.id });
    expect(await verifyToken('lixo')).toBeNull();
  });

  it('GET /tasks returns only the tasks of the token user', async () => {
    expect((await createTask(users.a!.token, 'Tarefa de A')).status).toBe(201);
    expect((await createTask(users.b!.token, 'Tarefa de B')).status).toBe(201);
    const a = (await (await listTasks({ Authorization: `Bearer ${users.a!.token}` })).json()) as { title: string }[];
    const b = (await (await listTasks({ Authorization: `Bearer ${users.b!.token}` })).json()) as { title: string }[];
    expect(a.map((t) => t.title)).toEqual(['Tarefa de A']);
    expect(b.map((t) => t.title)).toEqual(['Tarefa de B']);
  });

  it('rejects missing and garbage tokens with 401', async () => {
    expect((await listTasks({})).status).toBe(401);
    expect((await listTasks({ Authorization: 'Bearer lixo' })).status).toBe(401);
  });
});
