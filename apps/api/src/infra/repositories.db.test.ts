import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IsoDate } from '@nexus/shared';
import type { NewTask } from '../application/ports.js';
import { getSupabaseEnv } from '../../test/db/supabase-env.js';
import { createSupabaseProfileRepository } from './supabase-profile-repository.js';
import { createSupabaseReminderRepository } from './supabase-reminder-repository.js';
import { createSupabaseTaskRepository } from './supabase-task-repository.js';

const env = getSupabaseEnv();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin: SupabaseClient = createClient(env.url, env.serviceRoleKey, opts);

const tasks = createSupabaseTaskRepository(admin);
const profiles = createSupabaseProfileRepository(admin);
const reminders = createSupabaseReminderRepository(admin);

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
    title: 'Tarefa',
    type: 'tarefa',
    status: 'pendente',
    dueDate: null,
    dueTime: null,
    fatal: false,
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
        source: 'telegram',
        sourceText: 'texto original',
      }),
    );
    expect(created.dueTime).toBe('09:00');
    expect(created.dueDate).toBe('2026-11-10');
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

  it('list: ordering, range, status, withoutDate', async () => {
    const L = await makeUser('list');
    const mk = (title: string, over: Partial<NewTask>) => tasks.create(L, newTask({ title, ...over }));
    const t1 = await mk('undated-1', {});
    const t2 = await mk('d11-untimed', { dueDate: d('2026-11-11') });
    const t3 = await mk('d11-10h', { dueDate: d('2026-11-11'), dueTime: '10:00' });
    const t4 = await mk('d10-done', { dueDate: d('2026-11-10'), status: 'concluida' });
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
  });
});

describe('profile repository', () => {
  it('defaults, update and isolation', async () => {
    expect(await profiles.get(A)).toEqual({
      timezone: 'America/Sao_Paulo',
      earlyReminderMinutes: 15,
      briefingTime: '08:00',
      telegramLinked: false,
      channelPaused: false,
    });
    const updated = await profiles.update(A, {
      timezone: 'America/Manaus',
      earlyReminderMinutes: 30,
      briefingTime: '07:30',
    });
    expect(updated).toEqual({
      timezone: 'America/Manaus',
      earlyReminderMinutes: 30,
      briefingTime: '07:30',
      telegramLinked: false,
      channelPaused: false,
    });
    expect(await profiles.get(A)).toEqual(updated);
    expect((await profiles.get(B)).timezone).toBe('America/Sao_Paulo');

    const partial = await profiles.update(A, { earlyReminderMinutes: 45, briefingTime: undefined });
    expect(partial).toMatchObject({ earlyReminderMinutes: 45, briefingTime: '07:30' });

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
      const now = new Date();

      expect(await tasks.get(A, bad)).toBeNull();
      expect(await tasks.update(A, bad, { title: 'x' })).toBeNull();
      expect(await tasks.softDelete(A, bad, now)).toBe(false);
    },
  );
});
