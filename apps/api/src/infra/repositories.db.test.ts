import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsoDate } from '@aj/shared';
import { ConflictError } from '../application/errors.js';
import type { NewTask } from '../application/ports.js';
import { getSupabaseEnv } from '../../test/db/supabase-env.js';
import { createSupabaseCaseRepository } from './supabase-case-repository.js';
import { createSupabaseHolidayRepository } from './supabase-holiday-repository.js';
import { createSupabaseProfileRepository } from './supabase-profile-repository.js';
import { createSupabaseReminderRepository } from './supabase-reminder-repository.js';
import { createSupabaseTaskRepository } from './supabase-task-repository.js';

const env = getSupabaseEnv();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin: SupabaseClient = createClient(env.url, env.serviceRoleKey, opts);

const tasks = createSupabaseTaskRepository(admin);
const cases = createSupabaseCaseRepository(admin);
const profiles = createSupabaseProfileRepository(admin);
const reminders = createSupabaseReminderRepository(admin);
const holidays = createSupabaseHolidayRepository(admin);

const createdIds: string[] = [];
let A = '';
let B = '';
let usersBefore = 0;

async function countUsers(): Promise<number> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return data.users.length;
}

async function makeUser(label: string): Promise<string> {
  const email = `${label}-${randomUUID()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  createdIds.push(data.user.id);
  return data.user.id;
}

const d = (s: string) => s as IsoDate;

function newTask(over: Partial<NewTask> = {}): NewTask {
  return {
    caseId: null,
    title: 'Tarefa',
    type: 'tarefa',
    status: 'pendente',
    dueDate: null,
    dueTime: null,
    fatal: false,
    baseDate: null,
    periodDays: null,
    countType: null,
    completedAt: null,
    source: 'painel',
    sourceText: null,
    ...over,
  };
}

beforeAll(async () => {
  usersBefore = await countUsers();
  A = await makeUser('a');
  B = await makeUser('b');
}, 30_000);

afterAll(async () => {
  for (const id of createdIds) await admin.auth.admin.deleteUser(id);
  expect(await countUsers()).toBe(usersBefore);
}, 30_000);

describe('task repository', () => {
  it('create/get/update/softDelete lifecycle, mapping and isolation', async () => {
    const created = await tasks.create(
      A,
      newTask({
        title: 'Contestação',
        type: 'prazo',
        dueDate: d('2026-11-10'),
        dueTime: '09:00',
        fatal: true,
        baseDate: d('2026-10-26'),
        periodDays: 15,
        countType: 'uteis',
        source: 'telegram',
        sourceText: 'texto original',
      }),
    );
    expect(created.dueTime).toBe('09:00');
    expect(created.dueDate).toBe('2026-11-10');
    expect(created.baseDate).toBe('2026-10-26');
    expect(created.periodDays).toBe(15);
    expect(created.countType).toBe('uteis');
    expect(created.completedAt).toBeNull();
    expect(created.createdAt).toBe(new Date(created.createdAt).toISOString());
    expect(created.updatedAt).toBe(new Date(created.updatedAt).toISOString());

    // source / source_text round-trip (not in the DTO)
    const { data: raw, error } = await admin
      .from('tasks')
      .select('user_id, source, source_text, due_time')
      .eq('id', created.id)
      .single();
    expect(error).toBeNull();
    expect(raw).toMatchObject({ user_id: A, source: 'telegram', source_text: 'texto original' });

    // B data present
    const bTask = await tasks.create(B, newTask({ title: 'De B', dueDate: d('2026-11-10') }));

    expect(await tasks.get(A, created.id)).toEqual(created);
    expect(await tasks.get(B, created.id)).toBeNull();
    expect(await tasks.update(B, created.id, { title: 'invadida' })).toBeNull();
    expect(await tasks.softDelete(B, created.id, new Date())).toBe(false);
    expect((await tasks.get(A, created.id))!.title).toBe('Contestação');
    expect((await tasks.list(A, {})).map((t) => t.id)).not.toContain(bTask.id);
    expect((await tasks.list(B, {})).map((t) => t.id)).not.toContain(created.id);

    // update: undefined ignored
    const u1 = await tasks.update(A, created.id, { title: 'Novo título', status: 'em_andamento', dueDate: undefined });
    expect(u1).toMatchObject({ title: 'Novo título', status: 'em_andamento', dueDate: '2026-11-10', dueTime: '09:00' });

    // completedAt written and returned as ISO
    const done = await tasks.update(A, created.id, { status: 'concluida', completedAt: '2026-10-26T15:30:00.000Z' });
    expect(done!.completedAt).toBe('2026-10-26T15:30:00.000Z');

    // update: explicit null clears
    const u2 = await tasks.update(A, created.id, { dueDate: null, dueTime: null, completedAt: null });
    expect(u2).toMatchObject({ dueDate: null, dueTime: null, completedAt: null, title: 'Novo título' });

    // softDelete
    const now = new Date('2026-10-26T12:00:00Z');
    expect(await tasks.softDelete(A, created.id, now)).toBe(true);
    const { data: del } = await admin.from('tasks').select('deleted_at').eq('id', created.id).single();
    expect(new Date(del!.deleted_at as string).toISOString()).toBe(now.toISOString());
    expect(await tasks.softDelete(A, created.id, now)).toBe(false);
    expect(await tasks.get(A, created.id)).toBeNull();
    expect(await tasks.update(A, created.id, { title: 'x' })).toBeNull();
    expect((await tasks.list(A, {})).map((t) => t.id)).not.toContain(created.id);
    // B's task untouched
    expect(await tasks.get(B, bTask.id)).not.toBeNull();
  });

  it('list: ordering, range, status, withoutDate, caseId', async () => {
    const L = await makeUser('list');
    const c = await cases.create(L, { number: 'C-1' });
    const mk = (title: string, over: Partial<NewTask>) => tasks.create(L, newTask({ title, ...over }));
    const t1 = await mk('undated-1', {});
    const t2 = await mk('d11-untimed', { dueDate: d('2026-11-11') });
    const t3 = await mk('d11-10h', { dueDate: d('2026-11-11'), dueTime: '10:00' });
    const t4 = await mk('d10-case', { dueDate: d('2026-11-10'), caseId: c.id, status: 'concluida' });
    const t5 = await mk('d11-08h', { dueDate: d('2026-11-11'), dueTime: '08:00' });
    const t6 = await mk('d12', { dueDate: d('2026-11-12'), status: 'em_andamento' });
    const t7 = await mk('undated-2', {});
    // a different user's data present
    await tasks.create(A, newTask({ title: 'noise', dueDate: d('2026-11-11') }));

    const ids = (r: { id: string }[]) => r.map((x) => x.id);
    expect(ids(await tasks.list(L, {}))).toEqual([t4.id, t5.id, t3.id, t2.id, t6.id, t1.id, t7.id]);

    expect(ids(await tasks.list(L, { from: d('2026-11-11'), to: d('2026-11-11') }))).toEqual([t5.id, t3.id, t2.id]);
    expect(ids(await tasks.list(L, { from: d('2026-11-11') }))).toEqual([t5.id, t3.id, t2.id, t6.id]);
    expect(ids(await tasks.list(L, { to: d('2026-11-10') }))).toEqual([t4.id]);
    expect(ids(await tasks.list(L, { status: ['concluida', 'em_andamento'] }))).toEqual([t4.id, t6.id]);
    expect((await tasks.list(L, { status: [] })).length).toBe(7);
    expect(ids(await tasks.list(L, { withoutDate: true }))).toEqual([t1.id, t7.id]);
    expect(ids(await tasks.list(L, { caseId: c.id }))).toEqual([t4.id]);
  });
});

describe('case repository', () => {
  it('lifecycle, conflicts and isolation', async () => {
    const a1 = await cases.create(A, { number: `P-${randomUUID()}`, clientName: 'Cli', description: null });
    const a2 = await cases.create(A, { number: `P-${randomUUID()}` });
    const sameNumberOtherUser = await cases.create(B, { number: a1.number });
    expect(a1).toMatchObject({ clientName: 'Cli', description: null, status: 'ativo' });
    expect(a2.clientName).toBeNull();
    expect(a1.createdAt).toBe(new Date(a1.createdAt).toISOString());

    await expect(cases.create(A, { number: a1.number })).rejects.toEqual(new ConflictError('numero_ja_cadastrado'));
    await expect(cases.update(A, a2.id, { number: a1.number })).rejects.toBeInstanceOf(ConflictError);
    await expect(cases.update(A, a2.id, { number: a1.number })).rejects.toMatchObject({ code: 'numero_ja_cadastrado' });

    expect(await cases.get(A, a1.id)).toEqual(a1);
    expect(await cases.get(B, a1.id)).toBeNull();
    expect(await cases.update(B, a1.id, { clientName: 'invadido' })).toBeNull();
    expect((await cases.get(A, a1.id))!.clientName).toBe('Cli');

    const u = await cases.update(A, a1.id, { status: 'arquivado', description: 'desc', clientName: undefined });
    expect(u).toMatchObject({ status: 'arquivado', description: 'desc', clientName: 'Cli' });
    const cleared = await cases.update(A, a1.id, { clientName: null });
    expect(cleared!.clientName).toBeNull();

    const listA = await cases.list(A, {});
    expect(listA.map((c) => c.id)).toEqual(expect.arrayContaining([a1.id, a2.id]));
    expect(listA.map((c) => c.id)).not.toContain(sameNumberOtherUser.id);
    expect(listA.findIndex((c) => c.id === a1.id)).toBeLessThan(listA.findIndex((c) => c.id === a2.id));
    expect((await cases.list(A, { status: 'arquivado' })).map((c) => c.id)).toEqual([a1.id]);
    expect((await cases.list(A, { status: 'ativo' })).map((c) => c.id)).toEqual([a2.id]);
  });
});

describe('holiday repository', () => {
  it('admin methods, conflicts, isolation and listByUser unchanged', async () => {
    const h1 = await holidays.create(A, { date: d('2026-12-08'), scope: 'municipal', name: 'Tarde' });
    const h0 = await holidays.create(A, { date: d('2026-11-05'), scope: 'estadual', name: 'Cedo' });
    const hb = await holidays.create(B, { date: d('2026-12-08'), scope: 'municipal', name: 'De B' });
    expect(h1).toMatchObject({ date: '2026-12-08', scope: 'municipal', name: 'Tarde' });

    await expect(holidays.create(A, { date: d('2026-12-08'), scope: 'estadual', name: 'dup' })).rejects.toEqual(
      new ConflictError('feriado_ja_cadastrado'),
    );

    expect((await holidays.list(A)).map((h) => h.id)).toEqual([h0.id, h1.id]);
    expect((await holidays.list(B)).map((h) => h.id)).toEqual([hb.id]);
    expect(await holidays.listByUser(A, d('2026-01-01'), d('2026-12-31'))).toEqual([
      { date: '2026-11-05', name: 'Cedo' },
      { date: '2026-12-08', name: 'Tarde' },
    ]);

    expect(await holidays.remove(B, h1.id)).toBe(false);
    expect((await holidays.list(A)).length).toBe(2);
    expect(await holidays.remove(A, h1.id)).toBe(true);
    expect(await holidays.remove(A, h1.id)).toBe(false);
    expect((await holidays.list(A)).map((h) => h.id)).toEqual([h0.id]);
  });
});

describe('profile repository', () => {
  it('defaults, update and isolation', async () => {
    expect(await profiles.get(A)).toEqual({
      timezone: 'America/Sao_Paulo',
      uf: null,
      city: null,
      earlyReminderMinutes: 15,
      briefingTime: '08:00',
      telegramLinked: false,
      channelPaused: false,
    });
    const updated = await profiles.update(A, {
      timezone: 'America/Manaus',
      uf: 'SP',
      city: 'Campinas',
      earlyReminderMinutes: 30,
      briefingTime: '07:30',
    });
    expect(updated).toEqual({
      timezone: 'America/Manaus',
      uf: 'SP',
      city: 'Campinas',
      earlyReminderMinutes: 30,
      briefingTime: '07:30',
      telegramLinked: false,
      channelPaused: false,
    });
    expect(await profiles.get(A)).toEqual(updated);
    expect((await profiles.get(B)).timezone).toBe('America/Sao_Paulo');

    const partial = await profiles.update(A, { city: null, uf: undefined });
    expect(partial).toMatchObject({ city: null, uf: 'SP', briefingTime: '07:30' });

    await admin.from('profiles').update({ telegram_chat_id: Math.floor(Math.random() * 1e9) + 1 }).eq('id', A);
    expect((await profiles.get(A)).telegramLinked).toBe(true);

    await expect(profiles.get(randomUUID())).rejects.toThrow(/Falha ao/);
  });
});

describe('reminder repository', () => {
  async function stored(userId: string, taskId: string) {
    const { data, error } = await admin
      .from('reminders')
      .select('kind, scheduled_at, status')
      .eq('user_id', userId)
      .eq('task_id', taskId)
      .order('kind');
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ kind: r.kind as string, at: new Date(r.scheduled_at as string).toISOString() }));
  }

  it('replaces pending reminders, clears with [], rejects mismatched user', async () => {
    const task = await tasks.create(A, newTask({ dueDate: d('2026-11-10') }));
    const bTask = await tasks.create(B, newTask({ dueDate: d('2026-11-10') }));
    const t1 = new Date('2026-11-09T11:00:00Z');
    const t2 = new Date('2026-11-10T11:00:00Z');
    await reminders.replacePending(B, bTask.id, [{ kind: 'no_dia', scheduledAt: t2 }]);

    await reminders.replacePending(A, task.id, [
      { kind: 'dia_anterior', scheduledAt: t1 },
      { kind: 'no_dia', scheduledAt: t2 },
    ]);
    expect(await stored(A, task.id)).toEqual([
      { kind: 'dia_anterior', at: t1.toISOString() },
      { kind: 'no_dia', at: t2.toISOString() },
    ]);

    await reminders.replacePending(A, task.id, [{ kind: 'no_horario', scheduledAt: t2 }]);
    expect(await stored(A, task.id)).toEqual([{ kind: 'no_horario', at: t2.toISOString() }]);

    // B's reminder untouched, and A's userId with B's task fails without deleting
    await expect(
      // kind differs from B's existing active reminder, so the unique index does not skip the draft
      reminders.replacePending(A, bTask.id, [{ kind: 'dia_anterior', scheduledAt: t1 }]),
    ).rejects.toThrow(/23503|violates foreign key/);
    expect(await stored(B, bTask.id)).toEqual([{ kind: 'no_dia', at: t2.toISOString() }]);

    await reminders.replacePending(A, task.id, []);
    expect(await stored(A, task.id)).toEqual([]);
    expect(await stored(B, bTask.id)).toHaveLength(1);
  });
});

describe('malformed and unknown ids are "not found"', () => {
  it.each([['malformed', 'abc'], ['well-formed but nonexistent', randomUUID()]])(
    '%s id: null/false/[] without throwing',
    async (_label, bad) => {
      await tasks.create(A, newTask({ title: 'presente' }));
      await tasks.create(B, newTask({ title: 'presente B' }));
      await cases.create(B, { number: `X-${randomUUID()}` });
      const now = new Date();

      expect(await tasks.get(A, bad)).toBeNull();
      expect(await tasks.update(A, bad, { title: 'x' })).toBeNull();
      expect(await tasks.softDelete(A, bad, now)).toBe(false);
      expect(await cases.get(A, bad)).toBeNull();
      expect(await cases.update(A, bad, { clientName: 'x' })).toBeNull();
      expect(await holidays.remove(A, bad)).toBe(false);
      expect(await tasks.list(A, { caseId: bad })).toEqual([]);
    },
  );
});
