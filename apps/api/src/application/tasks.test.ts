import type { CreateTaskInput } from '@aj/shared';
import { describe, expect, it } from 'vitest';
import { createFakes } from '../../test/fakes.js';
import { HoraInvalidaError } from '../domain/reminders.js';
import { makeCalculateDeadline } from './calculate-deadline.js';
import { InvalidTransitionError } from '../domain/task-status.js';
import { ConflictError, InvalidInputError, NotFoundError } from './errors.js';
import type { NewTask } from './ports.js';
import { makeTaskUseCases } from './tasks.js';

const U1 = 'user-1';
const U2 = 'user-2';

function setup() {
  const fakes = createFakes({ now: new Date('2026-10-26T12:00:00Z') });
  const created: NewTask[] = [];
  const tasks = {
    ...fakes.tasks,
    create: async (userId: string, task: NewTask) => {
      created.push(task);
      return fakes.tasks.create(userId, task);
    },
  };
  const uc = makeTaskUseCases({
    tasks,
    cases: fakes.cases,
    profiles: fakes.profiles,
    reminders: fakes.reminders,
    calculateDeadline: makeCalculateDeadline({ holidays: fakes.holidays }),
    clock: fakes.clock,
  });
  return { fakes, uc, created };
}

const input = (p: Partial<CreateTaskInput> & { title: string }): CreateTaskInput => ({
  caseId: null,
  fatal: false,
  ...p,
});

const iso = (ds: { scheduledAt: Date }[]) => ds.map((d) => d.scheduledAt.toISOString());

describe('tasks.create', () => {
  it('title only: tarefa, pendente, no reminders', async () => {
    const { fakes, uc } = setup();
    const t = await uc.create(U1, input({ title: 'Ligar' }));
    expect(t).toMatchObject({ title: 'Ligar', type: 'tarefa', status: 'pendente', dueDate: null });
    expect(fakes.reminders.remindersFor(t.id, U1)).toEqual([]);
  });

  it('dueDate + fatal: three reminders', async () => {
    const { fakes, uc } = setup();
    const t = await uc.create(U1, input({ title: 'X', dueDate: '2026-10-30', fatal: true }));
    const r = fakes.reminders.remindersFor(t.id, U1);
    expect(r.map((d) => d.kind)).toEqual(['tres_dias', 'dia_anterior', 'no_dia']);
    expect(iso(r)).toEqual(['2026-10-27T11:00:00.000Z', '2026-10-29T11:00:00.000Z', '2026-10-30T11:00:00.000Z']);
  });

  it('dueDate + dueTime: antecipado and no_horario', async () => {
    const { fakes, uc } = setup();
    const t = await uc.create(U1, input({ title: 'X', dueDate: '2026-10-27', dueTime: '09:00' }));
    const r = fakes.reminders.remindersFor(t.id, U1);
    expect(r.map((d) => d.kind)).toEqual(['antecipado', 'no_horario']);
    expect(iso(r)).toEqual(['2026-10-27T11:45:00.000Z', '2026-10-27T12:00:00.000Z']);
  });

  it('deadline: computes dueDate, stores rule, defaults type prazo', async () => {
    const { uc } = setup();
    const t = await uc.create(
      U1,
      input({ title: 'Contestação', deadline: { baseDate: '2026-10-26', days: 15, countType: 'uteis' } }),
    );
    expect(t).toMatchObject({
      dueDate: '2026-11-17',
      baseDate: '2026-10-26',
      periodDays: 15,
      countType: 'uteis',
      type: 'prazo',
    });
  });

  it('deadline respects the user holiday', async () => {
    const { fakes, uc } = setup();
    await fakes.holidays.create(U1, { date: '2026-11-05', scope: 'municipal', name: 'Local' } as never);
    const t = await uc.create(
      U1,
      input({ title: 'X', deadline: { baseDate: '2026-10-26', days: 15, countType: 'uteis' } }),
    );
    expect(t.dueDate).toBe('2026-11-18');
  });

  it('explicit type is kept with a deadline', async () => {
    const { uc } = setup();
    const t = await uc.create(
      U1,
      input({ title: 'X', type: 'audiencia', deadline: { baseDate: '2026-10-26', days: 15, countType: 'uteis' } }),
    );
    expect(t.type).toBe('audiencia');
  });

  it('passes source to the repository', async () => {
    const { uc, created } = setup();
    await uc.create(U1, input({ title: 'A' }));
    await uc.create(U1, input({ title: 'B' }), 'telegram');
    expect(created.map((c) => [c.source, c.sourceText])).toEqual([
      ['painel', null],
      ['telegram', null],
    ]);
  });

  it("another user's case: NotFoundError('processo'), nothing stored", async () => {
    const { fakes, uc } = setup();
    const other = await fakes.cases.create(U2, { number: '0001' } as never);
    await expect(uc.create(U1, input({ title: 'X', caseId: other.id }))).rejects.toEqual(
      new NotFoundError('processo'),
    );
    expect(await uc.list(U1, {})).toEqual([]);
    expect(fakes.reminders.calls).toEqual([]);
  });

  it('own case is accepted', async () => {
    const { fakes, uc } = setup();
    const mine = await fakes.cases.create(U1, { number: '0001' } as never);
    const t = await uc.create(U1, input({ title: 'X', caseId: mine.id }));
    expect(t.caseId).toBe(mine.id);
  });

  it('nonexistent local time: HoraInvalidaError, nothing stored, no replace call', async () => {
    const { fakes, uc } = setup();
    fakes.setNow(new Date('2026-03-01T12:00:00Z'));
    fakes.setProfile(U1, { timezone: 'America/New_York' });
    await expect(uc.create(U1, input({ title: 'X', dueDate: '2026-03-08', dueTime: '02:30' }))).rejects.toBeInstanceOf(
      HoraInvalidaError,
    );
    expect(await uc.list(U1, {})).toEqual([]);
    expect(fakes.reminders.calls).toEqual([]);
  });

  it('reminder replace failure: original error rethrown, task soft-deleted', async () => {
    const { fakes, uc } = setup();
    fakes.reminders.failNextReplace();
    await expect(uc.create(U1, input({ title: 'X', dueDate: '2026-10-30' }))).rejects.toThrow('replace failed');
    expect(await uc.list(U1, {})).toEqual([]);
  });
});

describe('tasks.get', () => {
  it('returns own task; other user gets NotFoundError(tarefa)', async () => {
    const { uc } = setup();
    const t = await uc.create(U1, input({ title: 'X' }));
    await uc.create(U2, input({ title: 'Y' }));
    expect((await uc.get(U1, t.id)).id).toBe(t.id);
    await expect(uc.get(U2, t.id)).rejects.toEqual(new NotFoundError('tarefa'));
    await expect(uc.get(U1, 'nope')).rejects.toEqual(new NotFoundError('tarefa'));
  });
});

describe('tasks.list', () => {
  it('isolates users and filters by from/to/status/withoutDate', async () => {
    const { uc } = setup();
    const a = await uc.create(U1, input({ title: 'a', dueDate: '2026-10-28' }));
    const b = await uc.create(U1, input({ title: 'b', dueDate: '2026-11-10' }));
    const c = await uc.create(U1, input({ title: 'c' }));
    await uc.create(U2, input({ title: 'other', dueDate: '2026-10-28' }));
    await uc.create(U2, input({ title: 'other2' }));

    expect((await uc.list(U1, {})).map((t) => t.id)).toEqual([a.id, b.id, c.id]);
    expect((await uc.list(U1, { from: '2026-10-29' })).map((t) => t.id)).toEqual([b.id]);
    expect((await uc.list(U1, { to: '2026-10-29' })).map((t) => t.id)).toEqual([a.id]);
    expect((await uc.list(U1, { withoutDate: true })).map((t) => t.id)).toEqual([c.id]);
    expect(await uc.list(U1, { status: ['concluida'] })).toEqual([]);
    expect((await uc.list(U1, { status: ['pendente'] })).length).toBe(3);
    expect((await uc.list(U2, {})).map((t) => t.title).sort()).toEqual(['other', 'other2']);
  });
});

describe('tasks.update', () => {
  it('changing dueDate replaces the reminders', async () => {
    const { fakes, uc } = setup();
    const t = await uc.create(U1, input({ title: 'X', dueDate: '2026-10-30' }));
    const before = iso(fakes.reminders.remindersFor(t.id, U1));
    const u = await uc.update(U1, t.id, { dueDate: '2026-11-04' });
    expect(u.dueDate).toBe('2026-11-04');
    const after = iso(fakes.reminders.remindersFor(t.id, U1));
    expect(after.length).toBeGreaterThan(0);
    for (const i of before) expect(after).not.toContain(i);
    expect(after).toContain('2026-11-04T11:00:00.000Z');
  });

  it('concluida sets completedAt and clears reminders; reopening restores them', async () => {
    const { fakes, uc } = setup();
    const t = await uc.create(U1, input({ title: 'X', dueDate: '2026-10-30' }));
    const done = await uc.update(U1, t.id, { status: 'concluida' });
    expect(done.status).toBe('concluida');
    expect(done.completedAt).toBe('2026-10-26T12:00:00.000Z');
    expect(fakes.reminders.remindersFor(t.id, U1)).toEqual([]);
    const reopened = await uc.update(U1, t.id, { status: 'pendente' });
    expect(reopened.completedAt).toBeNull();
    expect(fakes.reminders.remindersFor(t.id, U1).length).toBeGreaterThan(0);
  });

  it('closed task rejects other fields; invalid transition propagates', async () => {
    const { uc } = setup();
    const t = await uc.create(U1, input({ title: 'X', dueDate: '2026-10-30' }));
    await uc.update(U1, t.id, { status: 'concluida' });
    await expect(uc.update(U1, t.id, { title: 'Y' })).rejects.toEqual(new ConflictError('tarefa_encerrada'));
    await expect(uc.update(U1, t.id, { status: 'em_andamento' })).rejects.toBeInstanceOf(InvalidTransitionError);
    expect((await uc.get(U1, t.id)).title).toBe('X');
  });

  it('same-status change is an invalid transition', async () => {
    const { uc } = setup();
    const t = await uc.create(U1, input({ title: 'X' }));
    await expect(uc.update(U1, t.id, { status: 'pendente' })).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('remove empties reminders and the task disappears', async () => {
    const { fakes, uc } = setup();
    const t = await uc.create(U1, input({ title: 'X', dueDate: '2026-10-30' }));
    await uc.remove(U1, t.id);
    expect(fakes.reminders.remindersFor(t.id, U1)).toEqual([]);
    await expect(uc.get(U1, t.id)).rejects.toEqual(new NotFoundError('tarefa'));
    expect(await uc.list(U1, {})).toEqual([]);
  });

  it('remove keeps the task deleted when clearing reminders fails, and rethrows', async () => {
    const { fakes, uc } = setup();
    const t = await uc.create(U1, input({ title: 'X', dueDate: '2026-10-30' }));
    fakes.reminders.failNextReplace();
    await expect(uc.remove(U1, t.id)).rejects.toThrow('replace failed');
    await expect(uc.get(U1, t.id)).rejects.toEqual(new NotFoundError('tarefa'));
  });

  it('dueDate: null clears dueTime and the rule', async () => {
    const { uc } = setup();
    const t = await uc.create(
      U1,
      input({ title: 'X', dueTime: '09:00', deadline: { baseDate: '2026-10-26', days: 15, countType: 'uteis' } }),
    );
    const u = await uc.update(U1, t.id, { dueDate: null });
    expect(u).toMatchObject({ dueDate: null, dueTime: null, baseDate: null, periodDays: null, countType: null });
  });

  it('fatal false->true on a date-only task adds tres_dias', async () => {
    const { fakes, uc } = setup();
    const t = await uc.create(U1, input({ title: 'X', dueDate: '2026-10-30' }));
    expect(fakes.reminders.remindersFor(t.id, U1).map((d) => d.kind)).not.toContain('tres_dias');
    await uc.update(U1, t.id, { fatal: true });
    expect(fakes.reminders.remindersFor(t.id, U1).map((d) => d.kind)).toContain('tres_dias');
  });

  it('nonexistent local time: HoraInvalidaError and the task is unchanged', async () => {
    const { fakes, uc } = setup();
    fakes.setNow(new Date('2026-03-01T12:00:00Z'));
    fakes.setProfile(U1, { timezone: 'America/New_York' });
    const t = await uc.create(U1, input({ title: 'X', dueDate: '2026-03-10', dueTime: '09:00' }));
    const callsBefore = fakes.reminders.calls.length;
    await expect(uc.update(U1, t.id, { dueDate: '2026-03-08', dueTime: '02:30' })).rejects.toBeInstanceOf(
      HoraInvalidaError,
    );
    expect(await uc.get(U1, t.id)).toEqual(t);
    expect(fakes.reminders.calls.length).toBe(callsBefore);
  });

  it('reminder replace failure: original error, previous values restored', async () => {
    const { fakes, uc } = setup();
    const t = await uc.create(U1, input({ title: 'X', dueDate: '2026-10-30' }));
    await uc.update(U1, t.id, { status: 'concluida' });
    fakes.reminders.failNextReplace();
    await expect(uc.update(U1, t.id, { status: 'pendente' })).rejects.toThrow('replace failed');
    expect(await uc.get(U1, t.id)).toMatchObject({
      status: 'concluida',
      completedAt: '2026-10-26T12:00:00.000Z',
      dueDate: '2026-10-30',
    });
    const t2 = await uc.create(U1, input({ title: 'Y', dueDate: '2026-10-30' }));
    fakes.reminders.failNextReplace();
    await expect(uc.update(U1, t2.id, { dueDate: '2026-11-04', status: 'em_andamento' })).rejects.toThrow(
      'replace failed',
    );
    expect(await uc.get(U1, t2.id)).toMatchObject({ status: 'pendente', dueDate: '2026-10-30', completedAt: null });
  });

  it("another user's task: NotFoundError(tarefa), first user's task untouched", async () => {
    const { uc } = setup();
    const t = await uc.create(U1, input({ title: 'X', dueDate: '2026-10-30' }));
    await uc.create(U2, input({ title: 'Y' }));
    await expect(uc.update(U2, t.id, { title: 'hack' })).rejects.toEqual(new NotFoundError('tarefa'));
    await expect(uc.remove(U2, t.id)).rejects.toEqual(new NotFoundError('tarefa'));
    expect(await uc.get(U1, t.id)).toEqual(t);
  });

  it("another user's caseId: NotFoundError(processo), nothing written", async () => {
    const { fakes, uc } = setup();
    const t = await uc.create(U1, input({ title: 'X' }));
    const other = await fakes.cases.create(U2, { number: '0001' } as never);
    await expect(uc.update(U1, t.id, { caseId: other.id })).rejects.toEqual(new NotFoundError('processo'));
    expect((await uc.get(U1, t.id)).caseId).toBeNull();
  });

  it('own caseId links, null unlinks, with no reminder replace', async () => {
    const { fakes, uc } = setup();
    const mine = await fakes.cases.create(U1, { number: '0001' } as never);
    const t = await uc.create(U1, input({ title: 'X', dueDate: '2026-10-30' }));
    const calls = fakes.reminders.calls.length;
    expect((await uc.update(U1, t.id, { caseId: mine.id })).caseId).toBe(mine.id);
    expect((await uc.update(U1, t.id, { caseId: null })).caseId).toBeNull();
    expect(fakes.reminders.calls.length).toBe(calls);
  });

  it('title-only update makes no replacePending call', async () => {
    const { fakes, uc } = setup();
    const t = await uc.create(U1, input({ title: 'X', dueDate: '2026-10-30' }));
    const calls = fakes.reminders.calls.length;
    await uc.update(U1, t.id, { title: 'Z', type: 'audiencia' });
    expect(fakes.reminders.calls.length).toBe(calls);
  });

  it('dueTime on an undated task: hora_sem_data, nothing stored', async () => {
    const { uc } = setup();
    const t = await uc.create(U1, input({ title: 'X' }));
    await expect(uc.update(U1, t.id, { dueTime: '09:00' })).rejects.toEqual(new InvalidInputError('hora_sem_data'));
    await expect(uc.update(U1, t.id, { dueDate: null, dueTime: '09:00' })).rejects.toEqual(
      new InvalidInputError('hora_sem_data'),
    );
    expect(await uc.get(U1, t.id)).toEqual(t);
  });

  it('explicit new dueDate clears the stored rule and keeps the time', async () => {
    const { uc } = setup();
    const t = await uc.create(
      U1,
      input({ title: 'X', dueTime: '09:00', deadline: { baseDate: '2026-10-26', days: 15, countType: 'uteis' } }),
    );
    const u = await uc.update(U1, t.id, { dueDate: '2026-12-01' });
    expect(u).toMatchObject({ dueDate: '2026-12-01', dueTime: '09:00', baseDate: null, periodDays: null, countType: null });
  });

  it('deadline recalculates dueDate and stores the rule', async () => {
    const { uc } = setup();
    const t = await uc.create(U1, input({ title: 'X', dueDate: '2026-10-30' }));
    const u = await uc.update(U1, t.id, { deadline: { baseDate: '2026-10-26', days: 15, countType: 'uteis' } });
    expect(u).toMatchObject({
      dueDate: '2026-11-17',
      baseDate: '2026-10-26',
      periodDays: 15,
      countType: 'uteis',
    });
  });
});
