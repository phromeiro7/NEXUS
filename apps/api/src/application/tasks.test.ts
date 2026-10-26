import type { CreateTaskInput } from '@aj/shared';
import { describe, expect, it } from 'vitest';
import { createFakes } from '../../test/fakes.js';
import { HoraInvalidaError } from '../domain/reminders.js';
import { makeCalculateDeadline } from './calculate-deadline.js';
import { NotFoundError } from './errors.js';
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
