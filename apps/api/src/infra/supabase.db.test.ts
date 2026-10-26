import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsoDate } from '@aj/shared';
import { createApp } from '../app.js';
import { makeCalculateDeadline } from '../application/calculate-deadline.js';
import { getSupabaseEnv } from '../../test/db/supabase-env.js';
import { createSupabaseAuthVerifier } from './supabase-auth.js';
import { makeGetBriefing } from '../application/briefing.js';
import { makeCaseUseCases } from '../application/cases.js';
import { makeHolidayUseCases } from '../application/holidays.js';
import { makeSettingsUseCases } from '../application/settings.js';
import { makeSyncReminders } from '../application/sync-reminders.js';
import { makeTaskUseCases } from '../application/tasks.js';
import { createSupabaseCaseRepository } from './supabase-case-repository.js';
import { createSupabaseHolidayRepository } from './supabase-holiday-repository.js';
import { createSupabaseProfileRepository } from './supabase-profile-repository.js';
import { createSupabaseReminderRepository } from './supabase-reminder-repository.js';
import { createSupabaseTaskRepository } from './supabase-task-repository.js';

// A: feriado municipal em 2026-11-05 (quinta, dentro do prazo) -> 2026-11-18.
// B: feriado em 2026-12-08 (terca, FORA do intervalo do prazo), logo B so
// desconta Finados (2026-11-02) e o prazo e 2026-11-17.
const A_HOLIDAY = '2026-11-05' as IsoDate;
const B_HOLIDAY = '2026-12-08' as IsoDate;

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
const holidays = createSupabaseHolidayRepository(admin);
const calculateDeadline = makeCalculateDeadline({ holidays });
const taskRepo = createSupabaseTaskRepository(admin);
const caseRepo = createSupabaseCaseRepository(admin);
const profileRepo = createSupabaseProfileRepository(admin);
const reminderRepo = createSupabaseReminderRepository(admin);
const clock = { now: () => new Date() };
const app = createApp({
  verifyToken,
  calculateDeadline,
  tasks: makeTaskUseCases({
    tasks: taskRepo,
    cases: caseRepo,
    profiles: profileRepo,
    reminders: reminderRepo,
    calculateDeadline,
    clock,
  }),
  cases: makeCaseUseCases({ cases: caseRepo }),
  holidays: makeHolidayUseCases({ holidays }),
  settings: makeSettingsUseCases({
    profiles: profileRepo,
    tasks: taskRepo,
    syncReminders: makeSyncReminders({ reminders: reminderRepo, clock }),
  }),
  briefing: makeGetBriefing({ tasks: taskRepo, profiles: profileRepo, clock }),
  webOrigin: 'http://localhost:3000',
});

const calc = (headers: Record<string, string>) =>
  app.request('/deadlines/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ baseDate: '2026-10-26', days: 15, countType: 'uteis' }),
  });

beforeAll(async () => {
  users.a = await makeUser('a');
  users.b = await makeUser('b');
  const { error } = await admin.from('holidays').insert([
    { user_id: users.a.id, date: A_HOLIDAY, scope: 'municipal', name: 'Feriado de A' },
    { user_id: users.b.id, date: B_HOLIDAY, scope: 'municipal', name: 'Feriado de B' },
  ]);
  if (error) throw new Error(`insert holidays: ${error.message}`);
}, 30_000);

afterAll(async () => {
  for (const id of createdIds) await admin.auth.admin.deleteUser(id);
});

type CalcBody = { dueDate: string; feriadosDescontados: { date: string }[] };

describe('Supabase local integration', () => {
  it('auth verifier: real token gives userId, garbage gives null', async () => {
    expect(await verifyToken(users.a!.token)).toEqual({ userId: users.a!.id });
    expect(await verifyToken(users.b!.token)).toEqual({ userId: users.b!.id });
    expect(await verifyToken('lixo')).toBeNull();
  });

  it('holiday repository returns only the requested user rows', async () => {
    const a = await holidays.listByUser(users.a!.id, '2026-01-01' as IsoDate, '2026-12-31' as IsoDate);
    expect(a).toEqual([{ date: A_HOLIDAY, name: 'Feriado de A' }]);
    const b = await holidays.listByUser(users.b!.id, '2026-01-01' as IsoDate, '2026-12-31' as IsoDate);
    expect(b).toEqual([{ date: B_HOLIDAY, name: 'Feriado de B' }]);
  });

  it('POST /deadlines/calculate discounts A holiday', async () => {
    const res = await calc({ Authorization: `Bearer ${users.a!.token}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CalcBody;
    expect(body.dueDate).toBe('2026-11-18');
    const dates = body.feriadosDescontados.map((h) => h.date);
    expect(dates).toContain('2026-11-02');
    expect(dates).toContain(A_HOLIDAY);
  });

  it('POST /deadlines/calculate for B does not use A holiday', async () => {
    const res = await calc({ Authorization: `Bearer ${users.b!.token}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CalcBody;
    expect(body.dueDate).toBe('2026-11-17');
    expect(body.feriadosDescontados.map((h) => h.date)).not.toContain(A_HOLIDAY);
  });

  it('rejects missing and garbage tokens with 401', async () => {
    expect((await calc({})).status).toBe(401);
    expect((await calc({ Authorization: 'Bearer lixo' })).status).toBe(401);
  });
});
