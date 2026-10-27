import { describe, expect, it } from 'vitest';
import type { IsoDate } from '@aj/shared';
import { ConflictError, ForeignEventError } from '../src/application/errors.js';
import type { NewTask } from '../src/application/ports.js';
import { createFakes } from './fakes.js';

const d = (s: string) => s as IsoDate;

const newTask = (over: Partial<NewTask> = {}): NewTask => ({
  caseId: null,
  title: 't',
  type: 'prazo',
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

  it('filters by status, from/to, caseId and withoutDate', async () => {
    const f = createFakes();
    const c = crypto.randomUUID();
    const a = await f.tasks.create('A', newTask({ title: 'a', dueDate: d('2026-10-27') }));
    const b = await f.tasks.create('A', newTask({ title: 'b', dueDate: d('2026-11-05'), status: 'concluida', caseId: c }));
    const n = await f.tasks.create('A', newTask({ title: 'n' }));
    const ids = async (q: Parameters<typeof f.tasks.list>[1]) => (await f.tasks.list('A', q)).map((t) => t.id);

    expect(await ids({ status: ['pendente'] })).toEqual([a.id, n.id]);
    expect(await ids({ status: [] })).toEqual([a.id, b.id, n.id]);
    expect(await ids({ status: ['pendente', 'pendente', 'concluida'] })).toEqual([a.id, b.id, n.id]);
    expect(await ids({ from: d('2026-10-27'), to: d('2026-10-27') })).toEqual([a.id]);
    expect(await ids({ from: d('2026-10-28') })).toEqual([b.id]);
    expect(await ids({ to: d('2026-11-05') })).toEqual([a.id, b.id]);
    expect(await ids({ caseId: c })).toEqual([b.id]);
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

describe('fakes: cases', () => {
  it('rejects a duplicate number for the same user only', async () => {
    const f = createFakes();
    await f.cases.create('A', { number: '123' });
    await expect(f.cases.create('A', { number: '123' })).rejects.toEqual(new ConflictError('numero_ja_cadastrado'));
    await expect(f.cases.create('B', { number: '123' })).resolves.toMatchObject({ number: '123' });
  });

  it('isolates users, filters by status and updates', async () => {
    const f = createFakes();
    const c = await f.cases.create('A', { number: '1', clientName: 'Ana' });
    expect(c).toMatchObject({ number: '1', clientName: 'Ana', description: null, status: 'ativo' });
    expect(await f.cases.get('B', c.id)).toBeNull();
    expect(await f.cases.list('B', {})).toEqual([]);
    expect(await f.cases.update('B', c.id, { status: 'arquivado' })).toBeNull();
    const u = await f.cases.update('A', c.id, { status: 'arquivado' });
    expect(u?.status).toBe('arquivado');
    expect(await f.cases.list('A', { status: 'ativo' })).toEqual([]);
    expect(await f.cases.list('A', { status: 'arquivado' })).toHaveLength(1);
    expect(await f.cases.list('A', {})).toHaveLength(1);
  });

  it('update to a number already used by another case conflicts', async () => {
    const f = createFakes();
    await f.cases.create('A', { number: '1' });
    const c2 = await f.cases.create('A', { number: '2' });
    await expect(f.cases.update('A', c2.id, { number: '1' })).rejects.toEqual(new ConflictError('numero_ja_cadastrado'));
  });
});

describe('fakes: profiles', () => {
  it('seeds defaults, isolates and updates per user', async () => {
    const f = createFakes();
    expect(await f.profiles.get('A')).toEqual({
      timezone: 'America/Sao_Paulo', uf: null, city: null,
      earlyReminderMinutes: 15, briefingTime: '08:00', telegramLinked: false,
    });
    await f.profiles.update('A', { uf: 'SP', earlyReminderMinutes: 30 });
    expect(await f.profiles.get('A')).toMatchObject({ uf: 'SP', earlyReminderMinutes: 30 });
    expect(await f.profiles.get('B')).toMatchObject({ uf: null, earlyReminderMinutes: 15 });
    f.setProfile('B', { telegramLinked: true });
    expect((await f.profiles.get('B')).telegramLinked).toBe(true);
    expect((await f.profiles.get('A')).telegramLinked).toBe(false);
  });
});

describe('fakes: holidays', () => {
  it('creates, lists, removes and isolates users; duplicate date conflicts', async () => {
    const f = createFakes();
    const h = await f.holidays.create('A', { date: d('2026-12-08'), scope: 'municipal', name: 'Padroeira' });
    await expect(f.holidays.create('A', { date: d('2026-12-08'), scope: 'estadual', name: 'x' }))
      .rejects.toEqual(new ConflictError('feriado_ja_cadastrado'));
    await expect(f.holidays.create('B', { date: d('2026-12-08'), scope: 'estadual', name: 'x' })).resolves.toBeDefined();
    expect(await f.holidays.list('A')).toEqual([h]);
    expect(await f.holidays.listByUser('A', d('2026-12-01'), d('2026-12-31'))).toEqual([{ date: '2026-12-08', name: 'Padroeira' }]);
    expect(await f.holidays.listByUser('A', d('2026-12-09'), d('2026-12-31'))).toEqual([]);
    expect(await f.holidays.remove('B', h.id)).toBe(false);
    expect(await f.holidays.list('A')).toHaveLength(1);
    expect(await f.holidays.remove('A', h.id)).toBe(true);
    expect(await f.holidays.remove('A', h.id)).toBe(false);
    expect(await f.holidays.list('A')).toEqual([]);
  });
});

describe('fakes: reminders', () => {
  const draft = (iso: string) => ({ kind: 'no_dia' as const, scheduledAt: new Date(iso) });

  it('replacePending replaces previous drafts and records calls', async () => {
    const f = createFakes();
    await f.reminders.replacePending('A', 't1', [draft('2026-11-01T11:00:00Z')]);
    await f.reminders.replacePending('A', 't1', [draft('2026-11-02T11:00:00Z')]);
    expect(f.reminders.remindersFor('t1')).toEqual([draft('2026-11-02T11:00:00Z')]);
    expect(f.reminders.calls).toHaveLength(2);
    expect(f.reminders.calls[0]).toMatchObject({ userId: 'A', taskId: 't1' });
  });

  it('keeps reminders of different users with the same task id apart', async () => {
    const f = createFakes();
    await f.reminders.replacePending('A', 't1', [draft('2026-11-01T11:00:00Z')]);
    await f.reminders.replacePending('B', 't1', []);
    expect(f.reminders.remindersFor('t1', 'A')).toHaveLength(1);
    expect(f.reminders.remindersFor('t1', 'B')).toEqual([]);
  });

  it('failNextReplace makes only the next call throw, leaving state untouched', async () => {
    const f = createFakes();
    await f.reminders.replacePending('A', 't1', [draft('2026-11-01T11:00:00Z')]);
    f.reminders.failNextReplace();
    await expect(f.reminders.replacePending('A', 't1', [])).rejects.toThrow('replace failed');
    expect(f.reminders.remindersFor('t1')).toHaveLength(1);
    await expect(f.reminders.replacePending('A', 't1', [])).resolves.toBeUndefined();
    expect(f.reminders.remindersFor('t1')).toEqual([]);
  });
});

describe('fakes: chat', () => {
  const t = (m: number) => new Date(Date.UTC(2026, 9, 27, 12, m));

  it('returns chronological, limited, unexpired messages of the user and channel', async () => {
    const f = createFakes();
    await f.chat.append('A', 'painel', 'user', 'velha', new Date('2026-10-25T00:00:00Z'));
    await f.chat.append('A', 'painel', 'user', 'um', t(1));
    await f.chat.append('A', 'painel', 'assistant', 'dois', t(1));
    await f.chat.append('A', 'telegram', 'user', 'outro canal', t(2));
    await f.chat.append('B', 'painel', 'user', 'de B', t(2));
    expect(await f.chat.recent('A', 'painel', 10, t(5))).toEqual([
      { role: 'user', content: 'um' },
      { role: 'assistant', content: 'dois' },
    ]);
    expect(await f.chat.recent('A', 'painel', 1, t(5))).toEqual([{ role: 'assistant', content: 'dois' }]);
  });
});

describe('fakes: inbound events', () => {
  const now = new Date('2026-10-27T12:00:00Z');

  it('registers once, reprocesses failed, replays the stored reply', async () => {
    const f = createFakes();
    const e = f.inboundEvents;
    expect(await e.register('A', 'painel', 'x', now)).toEqual({ firstTime: true, status: 'recebido', reply: null });
    expect((await e.register('A', 'painel', 'x', now)).firstTime).toBe(false);
    await e.beginModelCall('painel', 'x', now);
    await e.markFailed('painel', 'x', now);
    expect(await e.register('A', 'painel', 'x', now)).toEqual({ firstTime: true, status: 'recebido', reply: null });
    await e.markProcessed('painel', 'x', { a: { b: 1 } }, now);
    expect(await e.register('A', 'painel', 'x', now)).toEqual({
      firstTime: false,
      status: 'processado',
      reply: { a: { b: 1 } },
    });
  });

  it('refuses another user, adopts null-user events and keeps channels apart', async () => {
    const f = createFakes();
    const e = f.inboundEvents;
    await e.register(null, 'telegram', 'y', now);
    expect((await e.register('A', 'telegram', 'y', now)).firstTime).toBe(false);
    await expect(e.register('B', 'telegram', 'y', now)).rejects.toBeInstanceOf(ForeignEventError);
    expect((await e.register('A', 'painel', 'y', now)).firstTime).toBe(true);
  });

  it('countSince counts only attempt_count >= 1 of the user, channel and window', async () => {
    const f = createFakes();
    const e = f.inboundEvents;
    const since = new Date('2026-10-27T11:00:00Z');
    await e.register('A', 'painel', '1', now);
    await e.beginModelCall('painel', '1', now);
    await e.register('A', 'painel', '2', now); // refused: no model call
    await e.register('A', 'painel', '3', new Date('2026-10-27T10:00:00Z'));
    await e.beginModelCall('painel', '3', now);
    await e.register('B', 'painel', '4', now);
    await e.beginModelCall('painel', '4', now);
    expect(await e.countSince('A', 'painel', since)).toBe(1);
    expect(await e.countSince('A', 'telegram', since)).toBe(0);
  });
});

describe('fakes: clock', () => {
  it('starts at 2026-10-26T12:00:00Z and can be changed', () => {
    const f = createFakes();
    expect(f.clock.now()).toEqual(new Date('2026-10-26T12:00:00Z'));
    f.setNow(new Date('2026-10-27T00:00:00Z'));
    expect(f.clock.now()).toEqual(new Date('2026-10-27T00:00:00Z'));
  });
});
