import { describe, expect, it } from 'vitest';
import type { IsoDate } from '@nexus/shared';
import { ConflictError, EventStateError, ForeignEventError } from '../src/application/errors.js';
import type { NewTask } from '../src/application/ports.js';
import { createFakes } from './fakes.js';

const d = (s: string) => s as IsoDate;

const newTask = (over: Partial<NewTask> = {}): NewTask => ({
  title: 't',
  type: 'prazo',
  status: 'pendente',
  dueDate: null,
  dueTime: null,
  fatal: false,
  completedAt: null,
  source: 'painel',
  sourceText: null,
  ...over,
});

describe('fakes: tasks', () => {
  it('creates and reads a task of A', async () => {
    const f = createFakes();
    const t = await f.tasks.create('A', newTask({ title: 'x' }));
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await f.tasks.get('A', t.id)).toEqual(t);
    expect('source' in t).toBe(false);
  });

  it('isolates users on get, list, update and softDelete', async () => {
    const f = createFakes();
    const t = await f.tasks.create('A', newTask());
    expect(await f.tasks.get('B', t.id)).toBeNull();
    expect(await f.tasks.list('B', {})).toEqual([]);
    expect(await f.tasks.update('B', t.id, { title: 'hack' })).toBeNull();
    expect(await f.tasks.softDelete('B', t.id, new Date())).toBe(false);
    expect((await f.tasks.get('A', t.id))?.title).toBe('t');
  });

  it('update returns the updated dto', async () => {
    const f = createFakes();
    const t = await f.tasks.create('A', newTask());
    const u = await f.tasks.update('A', t.id, { status: 'concluida', completedAt: '2026-10-26T12:00:00.000Z' });
    expect(u?.status).toBe('concluida');
    expect(u?.completedAt).toBe('2026-10-26T12:00:00.000Z');
  });

  it('softDelete hides from get, list and update', async () => {
    const f = createFakes();
    const t = await f.tasks.create('A', newTask());
    expect(await f.tasks.softDelete('A', t.id, new Date())).toBe(true);
    expect(await f.tasks.softDelete('A', t.id, new Date())).toBe(false);
    expect(await f.tasks.get('A', t.id)).toBeNull();
    expect(await f.tasks.list('A', {})).toEqual([]);
    expect(await f.tasks.update('A', t.id, { title: 'z' })).toBeNull();
  });

  it('filters by status, from/to and withoutDate', async () => {
    const f = createFakes();
    const a = await f.tasks.create('A', newTask({ title: 'a', dueDate: d('2026-10-27') }));
    const b = await f.tasks.create('A', newTask({ title: 'b', dueDate: d('2026-11-05'), status: 'concluida' }));
    const n = await f.tasks.create('A', newTask({ title: 'n' }));
    const ids = async (q: Parameters<typeof f.tasks.list>[1]) => (await f.tasks.list('A', q)).map((t) => t.id);

    expect(await ids({ status: ['pendente'] })).toEqual([a.id, n.id]);
    expect(await ids({ status: [] })).toEqual([a.id, b.id, n.id]);
    expect(await ids({ status: ['pendente', 'pendente', 'concluida'] })).toEqual([a.id, b.id, n.id]);
    expect(await ids({ from: d('2026-10-27'), to: d('2026-10-27') })).toEqual([a.id]);
    expect(await ids({ from: d('2026-10-28') })).toEqual([b.id]);
    expect(await ids({ to: d('2026-11-05') })).toEqual([a.id, b.id]);
    expect(await ids({ withoutDate: true })).toEqual([n.id]);
  });

  it('orders by dueDate (nulls last), dueTime (null last), then createdAt', async () => {
    const f = createFakes();
    const nul = await f.tasks.create('A', newTask({ title: 'nul' }));
    const late = await f.tasks.create('A', newTask({ dueDate: d('2026-10-28') }));
    const noTime = await f.tasks.create('A', newTask({ dueDate: d('2026-10-27') }));
    const t10 = await f.tasks.create('A', newTask({ dueDate: d('2026-10-27'), dueTime: '10:00' }));
    const t09 = await f.tasks.create('A', newTask({ dueDate: d('2026-10-27'), dueTime: '09:00' }));
    const out = (await f.tasks.list('A', {})).map((t) => t.id);
    expect(out).toEqual([t09.id, t10.id, noTime.id, late.id, nul.id]);
  });

  it('breaks full ties by createdAt', async () => {
    const f = createFakes();
    const first = await f.tasks.create('A', newTask());
    f.setNow(new Date('2026-10-26T12:00:01Z'));
    const second = await f.tasks.create('A', newTask());
    expect((await f.tasks.list('A', {})).map((t) => t.id)).toEqual([first.id, second.id]);
  });
});

describe('fakes: profiles', () => {
  it('seeds defaults, isolates and updates per user', async () => {
    const f = createFakes();
    expect(await f.profiles.get('A')).toEqual({
      timezone: 'America/Sao_Paulo',
      earlyReminderMinutes: 15, briefingTime: '08:00', telegramLinked: false, channelPaused: false,
    });
    await f.profiles.update('A', { earlyReminderMinutes: 30 });
    expect(await f.profiles.get('A')).toMatchObject({ earlyReminderMinutes: 30 });
    expect(await f.profiles.get('B')).toMatchObject({ earlyReminderMinutes: 15 });
    f.setProfile('B', { telegramLinked: true });
    expect((await f.profiles.get('B')).telegramLinked).toBe(true);
    expect((await f.profiles.get('A')).telegramLinked).toBe(false);
  });
});
