import type { TaskDto } from '@nexus/shared';
import { describe, expect, it } from 'vitest';
import { createFakes } from '../../test/fakes.js';
import type { NewTask } from './ports.js';
import { makeSettingsUseCases } from './settings.js';
import { makeSyncReminders } from './sync-reminders.js';

const U1 = 'user-1';
const U2 = 'user-2';

const task = (title: string, p: Partial<NewTask> = {}): NewTask => ({
  caseId: null,
  title,
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
  ...p,
});

function setup(now = '2026-10-26T12:00:00Z') {
  const fakes = createFakes({ now: new Date(now) });
  const syncReminders = makeSyncReminders({ reminders: fakes.reminders, clock: fakes.clock });
  const uc = makeSettingsUseCases({ profiles: fakes.profiles, tasks: fakes.tasks, syncReminders });
  /** Cria a tarefa e seus lembretes com o perfil atual do usuário. */
  const seed = async (userId: string, t: NewTask): Promise<TaskDto> => {
    const created = await fakes.tasks.create(userId, t);
    await syncReminders(userId, created, await fakes.profiles.get(userId));
    return created;
  };
  const instants = (taskId: string, userId: string) =>
    fakes.reminders.remindersFor(taskId, userId).map((d) => `${d.kind} ${d.scheduledAt.toISOString()}`);
  return { fakes, uc, seed, instants };
}

describe('settings.get', () => {
  it("returns the token user's settings", async () => {
    const { fakes, uc } = setup();
    fakes.setProfile(U1, { city: 'Recife' });
    fakes.setProfile(U2, { city: 'Natal' });
    expect((await uc.get(U1)).city).toBe('Recife');
    expect((await uc.get(U2)).city).toBe('Natal');
  });
});

describe('settings.update', () => {
  it('earlyReminderMinutes 15 -> 30 rebuilds open dated tasks with the NEW value', async () => {
    const { fakes, uc, seed, instants } = setup();
    const timed = await seed(U1, task('timed', { dueDate: '2026-10-27', dueTime: '09:00' }));
    const dateOnly = await seed(U1, task('dateonly', { dueDate: '2026-10-30', fatal: true }));
    const doing = await seed(U1, task('doing', { dueDate: '2026-10-28', dueTime: '10:00', status: 'em_andamento' }));
    expect(instants(timed.id, U1)).toEqual([
      'antecipado 2026-10-27T11:45:00.000Z',
      'no_horario 2026-10-27T12:00:00.000Z',
    ]);
    const before = fakes.reminders.calls.length;

    const result = await uc.update(U1, { earlyReminderMinutes: 30 });

    expect(result.settings.earlyReminderMinutes).toBe(30);
    expect(result.remindersRebuilt).toBe(3);
    expect(result.remindersSkipped).toBe(0);
    expect(fakes.reminders.calls.length).toBe(before + 3);
    expect(instants(timed.id, U1)).toEqual([
      'antecipado 2026-10-27T11:30:00.000Z',
      'no_horario 2026-10-27T12:00:00.000Z',
    ]);
    expect(instants(doing.id, U1)).toEqual([
      'antecipado 2026-10-28T12:30:00.000Z',
      'no_horario 2026-10-28T13:00:00.000Z',
    ]);
    expect(instants(dateOnly.id, U1)).toEqual([
      'tres_dias 2026-10-27T11:00:00.000Z',
      'dia_anterior 2026-10-29T11:00:00.000Z',
      'no_dia 2026-10-30T11:00:00.000Z',
    ]);
  });

  it('re-sending the same earlyReminderMinutes after a failed rebuild completes the rebuild', async () => {
    const { fakes, uc, seed, instants } = setup();
    const a = await seed(U1, task('a', { dueDate: '2026-10-27', dueTime: '09:00' }));
    const b = await seed(U1, task('b', { dueDate: '2026-10-30', fatal: true }));

    // 1ª chamada: o perfil é gravado com 30, mas a reconstrução falha no primeiro replacePending.
    fakes.reminders.failNextReplace();
    await expect(uc.update(U1, { earlyReminderMinutes: 30 })).rejects.toThrow('replace failed');
    expect((await uc.get(U1)).earlyReminderMinutes).toBe(30);
    expect(instants(a.id, U1)).toEqual([
      'antecipado 2026-10-27T11:45:00.000Z',
      'no_horario 2026-10-27T12:00:00.000Z',
    ]);
    const before = fakes.reminders.calls.length;

    // 2ª chamada com o MESMO valor: precisa reconstruir tudo.
    const result = await uc.update(U1, { earlyReminderMinutes: 30 });

    expect(result).toEqual({
      settings: expect.objectContaining({ earlyReminderMinutes: 30 }),
      remindersRebuilt: 2,
      remindersSkipped: 0,
      skipped: [],
    });
    expect(fakes.reminders.calls.slice(before).map((c) => c.taskId)).toEqual([a.id, b.id]);
    expect(instants(a.id, U1)).toEqual([
      'antecipado 2026-10-27T11:30:00.000Z',
      'no_horario 2026-10-27T12:00:00.000Z',
    ]);
    expect(instants(b.id, U1)).toEqual([
      'tres_dias 2026-10-27T11:00:00.000Z',
      'dia_anterior 2026-10-29T11:00:00.000Z',
      'no_dia 2026-10-30T11:00:00.000Z',
    ]);
  });

  it('re-sending the same value on a healthy account is harmless: it rebuilds again, with identical instants and the same counts', async () => {
    const { fakes, uc, seed, instants } = setup();
    const a = await seed(U1, task('a', { dueDate: '2026-10-27', dueTime: '09:00' }));
    const b = await seed(U1, task('b', { dueDate: '2026-10-30' }));
    const first = await uc.update(U1, { earlyReminderMinutes: 15, timezone: 'America/Sao_Paulo' });
    const snapshot = [instants(a.id, U1), instants(b.id, U1)];
    const before = fakes.reminders.calls.length;

    const second = await uc.update(U1, { earlyReminderMinutes: 15, timezone: 'America/Sao_Paulo' });

    expect(first).toMatchObject({ remindersRebuilt: 2, remindersSkipped: 0, skipped: [] });
    expect(second).toEqual(first);
    expect(fakes.reminders.calls.length).toBe(before + 2);
    expect([instants(a.id, U1), instants(b.id, U1)]).toEqual(snapshot);
    expect(instants(a.id, U1)).toEqual([
      'antecipado 2026-10-27T11:45:00.000Z',
      'no_horario 2026-10-27T12:00:00.000Z',
    ]);
  });

  it('changing only city, uf or briefingTime makes no replacePending call', async () => {
    const { fakes, uc, seed } = setup();
    await seed(U1, task('t', { dueDate: '2026-10-27', dueTime: '09:00' }));
    const before = fakes.reminders.calls.length;
    const result = await uc.update(U1, { city: 'Recife', uf: 'PE', briefingTime: '07:30' });
    expect(result.settings).toMatchObject({ city: 'Recife', uf: 'PE', briefingTime: '07:30' });
    expect(result).toMatchObject({ remindersRebuilt: 0, remindersSkipped: 0, skipped: [] });
    expect(fakes.reminders.calls.length).toBe(before);
  });

  it('timezone change rebuilds with the NEW zone and skips tasks whose time no longer exists', async () => {
    const { fakes, uc, seed, instants } = setup('2026-03-01T12:00:00Z');
    // criadas quando o usuário ainda estava em São Paulo
    const gap = await seed(U1, task('gap', { dueDate: '2026-03-08', dueTime: '02:30' }));
    const normal = await seed(U1, task('normal', { dueDate: '2026-03-10', dueTime: '09:00' }));
    expect(instants(normal.id, U1)).toEqual([
      'antecipado 2026-03-10T11:45:00.000Z',
      'no_horario 2026-03-10T12:00:00.000Z',
    ]);
    const gapBefore = instants(gap.id, U1);
    const before = fakes.reminders.calls.length;

    const result = await uc.update(U1, { timezone: 'America/New_York' });

    expect(result.settings.timezone).toBe('America/New_York');
    expect(result.remindersSkipped).toBe(1);
    expect(result.skipped).toEqual([{ id: gap.id, title: 'gap', reason: 'hora_inexistente' }]);
    expect(result.remindersRebuilt).toBe(1);
    expect(fakes.reminders.calls.length).toBe(before + 1);
    expect(instants(normal.id, U1)).toEqual([
      'antecipado 2026-03-10T12:45:00.000Z',
      'no_horario 2026-03-10T13:00:00.000Z',
    ]);
    expect(instants(gap.id, U1)).toEqual(gapBefore);
  });

  it("closed tasks, undated tasks and other users' tasks are not touched", async () => {
    const { fakes, uc, seed, instants } = setup();
    fakes.setProfile(U2, { earlyReminderMinutes: 15 });
    const done = await seed(U1, task('done', { dueDate: '2026-10-27', dueTime: '09:00' }));
    await fakes.tasks.update(U1, done.id, { status: 'concluida', completedAt: '2026-10-26T12:00:00.000Z' });
    const undated = await seed(U1, task('undated'));
    const open = await seed(U1, task('open', { dueDate: '2026-10-27', dueTime: '09:00' }));
    const other = await seed(U2, task('other', { dueDate: '2026-10-27', dueTime: '09:00' }));
    const otherBefore = instants(other.id, U2);
    const doneBefore = instants(done.id, U1);
    const before = fakes.reminders.calls.length;

    const result = await uc.update(U1, { earlyReminderMinutes: 30 });

    expect(result).toMatchObject({ remindersRebuilt: 1, remindersSkipped: 0 });
    expect(fakes.reminders.calls.slice(before).map((c) => c.taskId)).toEqual([open.id]);
    expect(fakes.reminders.calls.slice(before).some((c) => c.taskId === undated.id)).toBe(false);
    expect(instants(done.id, U1)).toEqual(doneBefore);
    expect(instants(other.id, U2)).toEqual(otherBefore);
    expect(instants(open.id, U1)).toEqual([
      'antecipado 2026-10-27T11:30:00.000Z',
      'no_horario 2026-10-27T12:00:00.000Z',
    ]);
  });

  it('settings always belong to the token user', async () => {
    const { fakes, uc } = setup();
    fakes.setProfile(U2, { city: 'Natal', earlyReminderMinutes: 20 });
    await uc.update(U1, { city: 'Recife', earlyReminderMinutes: 40 });
    expect(await uc.get(U1)).toMatchObject({ city: 'Recife', earlyReminderMinutes: 40 });
    expect(await uc.get(U2)).toMatchObject({ city: 'Natal', earlyReminderMinutes: 20 });
  });

  it('an unexpected error while rebuilding propagates', async () => {
    const { fakes, uc, seed } = setup();
    await seed(U1, task('a', { dueDate: '2026-10-27', dueTime: '09:00' }));
    fakes.reminders.failNextReplace();
    await expect(uc.update(U1, { earlyReminderMinutes: 30 })).rejects.toThrow('replace failed');
  });
});
