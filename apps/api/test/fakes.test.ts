import { describe, expect, it } from 'vitest';
import type { IsoDate } from '@aj/shared';
import { ConflictError, EventStateError, ForeignEventError } from '../src/application/errors.js';
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
      earlyReminderMinutes: 15, briefingTime: '08:00', telegramLinked: false, channelPaused: false,
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
    await e.beginModelCall('A', 'painel', 'x', now);
    await e.markFailed('A', 'painel', 'x', now);
    expect(await e.register('A', 'painel', 'x', now)).toEqual({ firstTime: true, status: 'recebido', reply: null });
    await e.beginModelCall('A', 'painel', 'x', now);
    await e.markProcessed('A', 'painel', 'x', { a: { b: 1 } }, now);
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

  it('scopes transitions by user and status like the SQL', async () => {
    const f = createFakes();
    const e = f.inboundEvents;
    await e.register('A', 'painel', 'p', now);
    await expect(e.markProcessed('A', 'painel', 'p', {}, now)).rejects.toBeInstanceOf(EventStateError);
    await expect(e.beginModelCall('B', 'painel', 'p', now)).rejects.toBeInstanceOf(ForeignEventError);
    await expect(e.beginModelCall('A', 'painel', 'nope', now)).rejects.toBeInstanceOf(EventStateError);
    await e.beginModelCall('A', 'painel', 'p', now);
    await expect(e.beginModelCall('A', 'painel', 'p', now)).rejects.toBeInstanceOf(EventStateError);
    await expect(e.markProcessed('B', 'painel', 'p', { forged: 1 }, now)).rejects.toBeInstanceOf(ForeignEventError);
    await e.markProcessed('A', 'painel', 'p', { ok: 1 }, now);
    await expect(e.markFailed('A', 'painel', 'p', now)).rejects.toBeInstanceOf(EventStateError);
    expect(await e.register('A', 'painel', 'p', now)).toEqual({ firstTime: false, status: 'processado', reply: { ok: 1 } });
  });

  it('countSince counts model calls (>= cutoff) of the user and channel, not events or resets', async () => {
    const f = createFakes();
    const e = f.inboundEvents;
    const since = new Date('2026-10-27T11:00:00Z');
    await e.register('A', 'painel', '1', now);
    await e.beginModelCall('A', 'painel', '1', now);
    await e.register('A', 'painel', '2', now); // refused: no model call
    await e.markFailed('A', 'painel', '2', now);
    await e.register('A', 'painel', '2', now); // resend: reset does not count
    await e.register('A', 'painel', '3', since);
    await e.beginModelCall('A', 'painel', '3', since); // boundary counts
    await e.register('A', 'painel', '5', new Date('2026-10-27T10:00:00Z'));
    await e.beginModelCall('A', 'painel', '5', new Date('2026-10-27T10:59:59Z')); // before
    await e.register('B', 'painel', '4', now);
    await e.beginModelCall('B', 'painel', '4', now);
    expect(await e.countSince('A', since)).toBe(2);
    await e.register('A', 'telegram', 'tg', now);
    await e.beginModelCall('A', 'telegram', 'tg', now); // other channel counts too (limit is per user)
    expect(await e.countSince('A', since)).toBe(3);
    await e.markFailed('A', 'painel', '1', now);
    await e.register('A', 'painel', '1', now);
    await e.beginModelCall('A', 'painel', '1', now); // same event, second call
    expect(await e.countSince('A', since)).toBe(4);
  });
});

describe('fakes: telegram client', () => {
  it('records sends, returns increasing message ids and plays scripted results first', async () => {
    const f = createFakes();
    f.telegram.failNext({ kind: 'transient' });
    expect(await f.telegram.sendMessage(7, 'a')).toEqual({ ok: false, error: { kind: 'transient' } });
    expect(await f.telegram.sendMessage(7, 'b')).toEqual({ ok: true, messageId: 1000 });
    expect(await f.telegram.sendMessage(8, 'c')).toEqual({ ok: true, messageId: 1001 });
    expect(f.telegram.sent).toEqual([
      { chatId: 7, text: 'a' },
      { chatId: 7, text: 'b' },
      { chatId: 8, text: 'c' },
    ]);
  });
});

describe('fakes: link codes', () => {
  const T = new Date('2026-10-26T12:00:00Z');
  const later = (min: number) => new Date(T.getTime() + min * 60_000);

  it('create replaces ALL previous codes of the user and keeps other users codes', async () => {
    const f = createFakes();
    await f.links.create('A', 'C1', later(10));
    await f.links.create('A', 'C1b', later(10));
    await f.links.create('B', 'CB', later(10));
    await f.links.create('A', 'C2', later(10));
    expect(f.links.codesOf('A')).toEqual(['C2']);
    expect(f.links.codesOf('B')).toEqual(['CB']);
    expect(await f.links.consume('C1', 1, T)).toEqual({ status: 'invalido' });
  });

  it('consume: ok links, clears the pause, is single use', async () => {
    const f = createFakes();
    await f.reminderQueue.pauseChannel('A');
    await f.links.create('A', 'C1', later(10));
    expect(await f.links.consume('C1', 555, T)).toEqual({ status: 'ok', userId: 'A', accountHint: '*@fake.test' });
    expect(f.links.chatFor('A')).toBe(555);
    expect(f.links.isPaused('A')).toBe(false);
    expect((await f.profiles.get('A')).telegramLinked).toBe(true);
    expect(await f.links.consume('C1', 555, T)).toEqual({ status: 'invalido' });
    expect(await f.links.userForChat(555)).toBe('A');
  });

  it('consume: expired (expires_at <= now) is invalido and never links', async () => {
    const f = createFakes();
    await f.links.create('A', 'C1', later(10));
    expect(await f.links.consume('C1', 555, later(10))).toEqual({ status: 'invalido' });
    expect(await f.links.consume('C1', 555, later(11))).toEqual({ status: 'invalido' });
    expect(f.links.chatFor('A')).toBeNull();
  });

  it('consume: chat linked to another user is chat_em_uso and the code stays valid', async () => {
    const f = createFakes();
    f.links.setChat('A', 555);
    await f.links.create('B', 'CB', later(10));
    expect(await f.links.consume('CB', 555, T)).toEqual({ status: 'chat_em_uso' });
    expect(f.links.codesOf('B')).toEqual(['CB']);
    expect(f.links.chatFor('B')).toBeNull();
    // the owner relinking the same chat is fine
    await f.links.create('A', 'CA', later(10));
    expect(await f.links.consume('CA', 555, T)).toEqual({ status: 'ok', userId: 'A', accountHint: '*@fake.test' });
  });

  it('unlink clears only that user and userForChat returns null afterwards, never another user', async () => {
    const f = createFakes();
    f.links.setChat('A', 1);
    f.links.setChat('B', 2);
    expect(await f.links.userForChat(1)).toBe('A');
    expect(await f.links.userForChat(2)).toBe('B');
    expect(await f.links.userForChat(3)).toBeNull();
    await f.links.unlink('A');
    expect(await f.links.userForChat(1)).toBeNull();
    expect(await f.links.userForChat(2)).toBe('B');
    expect((await f.profiles.get('A')).telegramLinked).toBe(false);
  });
});

describe('fakes: reminder queue', () => {
  const NOW = new Date('2026-10-26T12:00:00Z');
  const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

  async function setup(over: Partial<NewTask> = {}) {
    const f = createFakes({ now: NOW });
    f.links.setChat('A', 900);
    const task = await f.tasks.create(
      'A',
      newTask({ title: 'Contestação', type: 'prazo', dueDate: d('2026-10-27'), dueTime: '14:30', fatal: true, ...over }),
    );
    return { f, task };
  }

  it('claimDue reserves due reminders, maps the columns and increments attempts', async () => {
    const { f, task } = await setup();
    f.setProfile('A', { timezone: 'America/Manaus' });
    const id = f.reminderQueue.seed({ userId: 'A', taskId: task.id, kind: 'dia_anterior', scheduledAt: ago(10) });
    const claimed = await f.reminderQueue.claimDue(NOW, 10);
    expect(claimed).toEqual([
      {
        reminderId: id,
        userId: 'A',
        taskId: task.id,
        kind: 'dia_anterior',
        scheduledAt: ago(10),
        attempts: 1,
        title: 'Contestação',
        taskType: 'prazo',
        dueDate: '2026-10-27',
        dueTime: '14:30',
        fatal: true,
        chatId: 900,
        timezone: 'America/Manaus',
      },
    ]);
    expect(f.reminderQueue.row(id)).toMatchObject({ status: 'enviando', lockedAt: NOW, attempts: 1 });
    expect(await f.reminderQueue.claimDue(NOW, 10)).toEqual([]);
  });

  it('claimDue skips not-due, too-late, unlinked, paused, deleted and closed-task reminders; honors limit and order', async () => {
    const { f, task } = await setup();
    f.links.setChat('B', 901);
    f.links.setChat('C', 902);
    const tb = await f.tasks.create('B', newTask({ dueDate: d('2026-10-27') }));
    const tc = await f.tasks.create('C', newTask({ dueDate: d('2026-10-27') }));
    const tn = await f.tasks.create('N', newTask({ dueDate: d('2026-10-27') })); // N has no chat
    const closed = await f.tasks.create('A', newTask({ dueDate: d('2026-10-27'), status: 'concluida' }));
    const gone = await f.tasks.create('A', newTask({ dueDate: d('2026-10-27') }));
    await f.tasks.softDelete('A', gone.id, NOW);
    await f.reminderQueue.pauseChannel('C');
    const q = f.reminderQueue;
    q.seed({ userId: 'A', taskId: task.id, scheduledAt: new Date(NOW.getTime() + 1) }); // future
    q.seed({ userId: 'A', taskId: task.id, scheduledAt: ago(24 * 60 + 1) }); // > 24 h late
    q.seed({ userId: 'N', taskId: tn.id, scheduledAt: ago(5) });
    q.seed({ userId: 'C', taskId: tc.id, scheduledAt: ago(5) });
    q.seed({ userId: 'A', taskId: closed.id, scheduledAt: ago(5) });
    q.seed({ userId: 'A', taskId: gone.id, scheduledAt: ago(5) });
    q.seed({ userId: 'A', taskId: task.id, scheduledAt: ago(5), nextAttemptAt: new Date(NOW.getTime() + 60_000) });
    const second = q.seed({ userId: 'A', taskId: task.id, scheduledAt: ago(5) });
    const first = q.seed({ userId: 'B', taskId: tb.id, scheduledAt: ago(30) });
    const exactlyDay = q.seed({ userId: 'A', taskId: task.id, scheduledAt: ago(24 * 60) });
    expect((await q.claimDue(NOW, 2)).map((c) => c.reminderId)).toEqual([exactlyDay, first]);
    expect((await q.claimDue(NOW, 10)).map((c) => c.reminderId)).toEqual([second]);
    expect(await q.claimDue(NOW, 0)).toEqual([]);
  });

  it('claimDue uses next_attempt_at over scheduled_at', async () => {
    const { f, task } = await setup();
    const id = f.reminderQueue.seed({
      userId: 'A',
      taskId: task.id,
      scheduledAt: ago(60),
      nextAttemptAt: ago(1),
      status: 'pendente',
      attempts: 1,
    });
    expect((await f.reminderQueue.claimDue(NOW, 5))[0]).toMatchObject({ reminderId: id, attempts: 2 });
  });

  it('cancelDead cancels late and dead-task reminders with the SQL reasons and counts them', async () => {
    const { f, task } = await setup();
    const gone = await f.tasks.create('A', newTask({ dueDate: d('2026-10-27') }));
    await f.tasks.softDelete('A', gone.id, NOW);
    const late = f.reminderQueue.seed({ userId: 'A', taskId: task.id, scheduledAt: ago(24 * 60 + 1) });
    const dead = f.reminderQueue.seed({ userId: 'A', taskId: gone.id, scheduledAt: ago(5) });
    const fine = f.reminderQueue.seed({ userId: 'A', taskId: task.id, scheduledAt: ago(5) });
    const sending = f.reminderQueue.seed({ userId: 'A', taskId: gone.id, scheduledAt: ago(5), status: 'enviando', lockedAt: NOW });
    expect(await f.reminderQueue.cancelDead(NOW)).toBe(2);
    expect(f.reminderQueue.row(late)).toMatchObject({ status: 'cancelado', lastError: 'atrasado_demais' });
    expect(f.reminderQueue.row(dead)).toMatchObject({ status: 'cancelado', lastError: 'tarefa_encerrada' });
    expect(f.reminderQueue.row(fine)?.status).toBe('pendente');
    expect(f.reminderQueue.row(sending)?.status).toBe('enviando');
  });

  it('recoverStuck returns to pendente only reminders locked for MORE than 5 minutes, keeping attempts', async () => {
    const { f, task } = await setup();
    const stuck = f.reminderQueue.seed({ userId: 'A', taskId: task.id, scheduledAt: ago(30), status: 'enviando', lockedAt: ago(5.01), attempts: 2 });
    const fresh = f.reminderQueue.seed({ userId: 'A', taskId: task.id, scheduledAt: ago(30), status: 'enviando', lockedAt: ago(5), attempts: 1 });
    expect(await f.reminderQueue.recoverStuck(NOW)).toBe(1);
    expect(f.reminderQueue.row(stuck)).toMatchObject({ status: 'pendente', lockedAt: null, attempts: 2 });
    expect(f.reminderQueue.row(fresh)?.status).toBe('enviando');
  });

  it('finish: success, retry and failure paths write the SQL columns', async () => {
    const { f, task } = await setup();
    const q = f.reminderQueue;
    const mk = async () => {
      const id = q.seed({ userId: 'A', taskId: task.id, scheduledAt: ago(5) });
      const [c] = await q.claimDue(NOW, 1);
      return { id, attempts: c!.attempts };
    };
    const a = await mk();
    await q.finish({ reminderId: a.id, attempts: a.attempts, status: 'enviado', error: null, nextAttemptAt: new Date(NOW.getTime() + 5) }, NOW);
    expect(q.row(a.id)).toMatchObject({ status: 'enviado', sentAt: NOW, nextAttemptAt: null, lockedAt: null, lastError: null });

    const b = await mk();
    const next = new Date(NOW.getTime() + 60_000);
    await q.finish({ reminderId: b.id, attempts: b.attempts, status: 'pendente', error: 'x'.repeat(300), nextAttemptAt: next }, NOW);
    expect(q.row(b.id)).toMatchObject({ status: 'pendente', nextAttemptAt: next, lockedAt: null, sentAt: null });
    expect(q.row(b.id)?.lastError).toHaveLength(200);

    const c = await mk();
    await q.finish({ reminderId: c.id, attempts: c.attempts, status: 'falhou', error: 'permanente', nextAttemptAt: null }, NOW);
    expect(q.row(c.id)).toMatchObject({ status: 'falhou', lastError: 'permanente' });
  });

  it('finish: typed lease errors in the SQL order, plain errors for bad input', async () => {
    const { f, task } = await setup();
    const q = f.reminderQueue;
    const id = q.seed({ userId: 'A', taskId: task.id, scheduledAt: ago(5) });
    const [c] = await q.claimDue(NOW, 1);
    const fin = (over: Record<string, unknown>) =>
      q.finish({ reminderId: id, attempts: c!.attempts, status: 'enviado', error: null, nextAttemptAt: null, ...over } as never, NOW);

    await expect(fin({ reminderId: crypto.randomUUID() })).rejects.toMatchObject({ name: 'ReminderLeaseError', code: 'lembrete_inexistente' });
    await expect(fin({ attempts: c!.attempts + 1 })).rejects.toMatchObject({ name: 'ReminderLeaseError', code: 'lembrete_reservado_por_outro' });
    await expect(fin({ status: 'pendente', nextAttemptAt: null })).rejects.toThrow('lembrete_sem_proxima_tentativa');
    await expect(fin({ status: 'xx' })).rejects.toThrow('status_invalido');
    expect(q.row(id)?.status).toBe('enviando');
    await fin({});
    await expect(fin({})).rejects.toMatchObject({ name: 'ReminderLeaseError', code: 'lembrete_em_estado_invalido' });
  });

  it('finish fences by attempts: a stale sender cannot finish a recovered and re-claimed reminder', async () => {
    const { f, task } = await setup();
    const q = f.reminderQueue;
    const id = q.seed({ userId: 'A', taskId: task.id, scheduledAt: ago(30) });
    const [first] = await q.claimDue(ago(10), 1);
    expect(await q.recoverStuck(NOW)).toBe(1);
    const [second] = await q.claimDue(NOW, 1);
    expect([first!.attempts, second!.attempts]).toEqual([1, 2]);
    await expect(
      q.finish({ reminderId: id, attempts: first!.attempts, status: 'enviado', error: null, nextAttemptAt: null }, NOW),
    ).rejects.toMatchObject({ code: 'lembrete_reservado_por_outro' });
    await q.finish({ reminderId: id, attempts: second!.attempts, status: 'enviado', error: null, nextAttemptAt: null }, NOW);
    expect(q.row(id)?.status).toBe('enviado');
  });

  it('pauseChannel pauses only that user, so claimDue skips them', async () => {
    const { f, task } = await setup();
    f.links.setChat('B', 901);
    const tb = await f.tasks.create('B', newTask({ dueDate: d('2026-10-27') }));
    f.reminderQueue.seed({ userId: 'A', taskId: task.id, scheduledAt: ago(5) });
    const idB = f.reminderQueue.seed({ userId: 'B', taskId: tb.id, scheduledAt: ago(5) });
    await f.reminderQueue.pauseChannel('A');
    expect(f.links.isPaused('A')).toBe(true);
    expect(f.links.isPaused('B')).toBe(false);
    expect((await f.reminderQueue.claimDue(NOW, 10)).map((c) => c.reminderId)).toEqual([idB]);
  });
});

describe('fakes: confirmations', () => {
  it('record is idempotent and tasksFor isolates users and counts deleted tasks', async () => {
    const f = createFakes();
    const a1 = await f.tasks.create('A', newTask());
    const a2 = await f.tasks.create('A', newTask());
    const b1 = await f.tasks.create('B', newTask());
    await f.confirmations.record(10, 20, [a1.id, a2.id]);
    await f.confirmations.record(10, 20, [a1.id, a2.id]);
    await f.confirmations.record(10, 20, [b1.id]);
    expect(await f.confirmations.tasksFor('A', 10, 20)).toEqual({ alive: [a1.id, a2.id].sort(), deletedCount: 0 });
    expect(await f.confirmations.tasksFor('B', 10, 20)).toEqual({ alive: [b1.id], deletedCount: 0 });
    await f.tasks.softDelete('A', a2.id, new Date());
    expect(await f.confirmations.tasksFor('A', 10, 20)).toEqual({ alive: [a1.id], deletedCount: 1 });
    expect(await f.confirmations.tasksFor('C', 10, 20)).toEqual({ alive: [], deletedCount: 0 });
    expect(await f.confirmations.tasksFor('A', 10, 21)).toEqual({ alive: [], deletedCount: 0 });
    expect(await f.confirmations.tasksFor('A', 11, 20)).toEqual({ alive: [], deletedCount: 0 });
  });

  it('record rejects an unknown task id like the foreign key', async () => {
    const f = createFakes();
    await expect(f.confirmations.record(1, 2, [crypto.randomUUID()])).rejects.toThrow();
  });
});

describe('fakes: maintenance', () => {
  const NOW = new Date('2026-10-26T12:00:00Z');
  const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

  it('purges expired chat messages (strictly before now) and link codes', async () => {
    const f = createFakes({ now: NOW });
    await f.chat.append('A', 'painel', 'user', 'velha', ago(24 * 60 + 1)); // expires 1 min ago
    await f.chat.append('A', 'painel', 'user', 'no limite', ago(24 * 60)); // expires exactly now
    await f.chat.append('A', 'painel', 'user', 'nova', ago(1));
    expect(await f.maintenance.purgeExpiredChatMessages(NOW)).toBe(1);
    expect(await f.maintenance.purgeExpiredChatMessages(NOW)).toBe(0);
    await f.links.create('A', 'X', ago(1));
    await f.links.create('B', 'Y', NOW);
    await f.links.create('C', 'Z', new Date(NOW.getTime() + 1));
    expect(await f.maintenance.purgeExpiredLinkCodes(NOW)).toBe(1);
    expect(f.links.codesOf('B')).toEqual(['Y']);
  });

  it('purges model calls older than 2 days (strictly)', async () => {
    const f = createFakes({ now: NOW });
    for (const [i, age] of [60 * 48 + 1, 60 * 48, 10].entries()) {
      await f.inboundEvents.register('A', 'painel', `e${i}`, NOW);
      await f.inboundEvents.beginModelCall('A', 'painel', `e${i}`, ago(age));
    }
    expect(await f.maintenance.purgeOldModelCalls(NOW)).toBe(1);
    expect(await f.inboundEvents.countSince('A', ago(60 * 100))).toBe(2);
  });

  it('recoverStuckEvents: calls made -> processado with a partial reply, none -> falhou, fresh ones untouched', async () => {
    const f = createFakes({ now: NOW });
    await f.inboundEvents.register('A', 'painel', 'with-call', ago(3));
    await f.inboundEvents.beginModelCall('A', 'painel', 'with-call', ago(3));
    await f.inboundEvents.register('A', 'painel', 'no-call', ago(3));
    await f.inboundEvents.register('A', 'painel', 'fresh', ago(2));
    await f.inboundEvents.register('A', 'painel', 'done', ago(10));
    await f.inboundEvents.beginModelCall('A', 'painel', 'done', ago(10));
    await f.inboundEvents.markProcessed('A', 'painel', 'done', { ok: 1 }, ago(9));
    expect(await f.maintenance.recoverStuckEvents(NOW)).toEqual({ recovered: 1, failed: 1 });
    expect(await f.maintenance.recoverStuckEvents(NOW)).toEqual({ recovered: 0, failed: 0 });
    const again = await f.inboundEvents.register('A', 'painel', 'with-call', NOW);
    expect(again.status).toBe('processado');
    expect(again.reply).toMatchObject({ affectedTasks: [] });
    expect((await f.inboundEvents.register('A', 'painel', 'no-call', NOW)).firstTime).toBe(true);
    expect((await f.inboundEvents.register('A', 'painel', 'fresh', NOW)).status).toBe('recebido');
  });
});

describe('fakes: briefings', () => {
  const setup = () => {
    const f = createFakes({ now: new Date('2026-10-26T11:00:00Z') }); // 08:00 em São Paulo
    f.links.setChat('A', 111);
    return f;
  };

  it('dueFor: vinculado, não pausado, na janela e sem envio no dia', async () => {
    const f = setup();
    expect(await f.briefings.dueFor(f.clock.now())).toEqual([
      { userId: 'A', chatId: 111, timezone: 'America/Sao_Paulo', localDate: '2026-10-26' },
    ]);
  });

  it('dueFor ignora desvinculado e pausado', async () => {
    const f = setup();
    f.links.setChat('B', null);
    f.links.setChat('C', 333);
    await f.reminderQueue.pauseChannel('C');
    expect((await f.briefings.dueFor(f.clock.now())).map((r) => r.userId)).toEqual(['A']);
  });

  it('claim é atômico: só o primeiro leva o dia; dia anterior ou igual não toma de novo', async () => {
    const f = setup();
    expect(await f.briefings.claim('A', d('2026-10-26'))).toBe(true);
    expect(await f.briefings.claim('A', d('2026-10-26'))).toBe(false);
    expect(await f.briefings.claim('A', d('2026-10-25'))).toBe(false);
    expect(f.briefings.lastSent('A')).toBe('2026-10-26');
    expect(await f.briefings.claim('A', d('2026-10-27'))).toBe(true);
  });

  it('claims simultâneos: exatamente um true', async () => {
    const f = setup();
    const r = await Promise.all([
      f.briefings.claim('A', d('2026-10-26')),
      f.briefings.claim('A', d('2026-10-26')),
    ]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  it('release volta para localDate - 1 só se o dia guardado é exatamente localDate', async () => {
    const f = setup();
    await f.briefings.claim('A', d('2026-10-26'));
    await f.briefings.release('A', d('2026-10-25')); // outro dia: nada
    expect(f.briefings.lastSent('A')).toBe('2026-10-26');
    await f.briefings.release('A', d('2026-10-26'));
    expect(f.briefings.lastSent('A')).toBe('2026-10-25');
    expect(await f.briefings.claim('A', d('2026-10-26'))).toBe(true);
  });

  it('release atravessa o início do mês', async () => {
    const f = setup();
    await f.briefings.claim('A', d('2026-11-01'));
    await f.briefings.release('A', d('2026-11-01'));
    expect(f.briefings.lastSent('A')).toBe('2026-10-31');
  });

  it('dueFor pula perfil com fuso inválido ou hora malformada e registra o usuário; os outros seguem', async () => {
    const f = setup();
    f.links.setChat('bad-tz', 222);
    f.setProfile('bad-tz', { timezone: 'Nowhere/Land' });
    f.links.setChat('bad-time', 333);
    f.setProfile('bad-time', { briefingTime: 'xx:yy' });
    expect((await f.briefings.dueFor(f.clock.now())).map((r) => r.userId)).toEqual(['A']);
    expect(f.briefings.skipped()).toEqual(['bad-tz', 'bad-time']);
  });

  it('dueFor deixa de devolver depois do claim', async () => {
    const f = setup();
    await f.briefings.claim('A', d('2026-10-26'));
    expect(await f.briefings.dueFor(f.clock.now())).toEqual([]);
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
