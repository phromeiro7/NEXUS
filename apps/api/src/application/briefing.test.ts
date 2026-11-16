import { describe, expect, it } from 'vitest';
import { createFakes } from '../../test/fakes.js';
import { makeGetBriefing } from './briefing.js';
import type { NewTask } from './ports.js';

const U1 = 'user-1';
const U2 = 'user-2';

const task = (title: string, p: Partial<NewTask> = {}): NewTask => ({
  title,
  type: 'tarefa',
  status: 'pendente',
  dueDate: null,
  dueTime: null,
  fatal: false,
  completedAt: null,
  source: 'painel',
  sourceText: null,
  ...p,
});

function setup(now: string) {
  const fakes = createFakes({ now: new Date(now) });
  return { fakes, get: makeGetBriefing({ tasks: fakes.tasks, profiles: fakes.profiles, clock: fakes.clock }) };
}

const titles = (l: { title: string }[]) => l.map((t) => t.title);

describe('getBriefing', () => {
  it('clock 2026-10-27T01:30Z in Sao Paulo is still 2026-10-26', async () => {
    const { fakes, get } = setup('2026-10-27T01:30:00Z');
    fakes.setProfile(U1, { timezone: 'America/Sao_Paulo' });
    await fakes.tasks.create(U1, task('late', { dueDate: '2026-10-25' }));
    await fakes.tasks.create(U1, task('today', { dueDate: '2026-10-26', fatal: true }));
    await fakes.tasks.create(U1, task('hear', { dueDate: '2026-10-26', type: 'audiencia', dueTime: '10:00' }));
    await fakes.tasks.create(U1, task('next', { dueDate: '2026-10-28' }));
    await fakes.tasks.create(U1, task('far', { dueDate: '2026-10-29' }));
    await fakes.tasks.create(U1, task('done', { dueDate: '2026-10-26', status: 'concluida', fatal: true }));
    const b = await get(U1);
    expect(b.today).toBe('2026-10-26');
    expect(titles(b.overdue)).toEqual(['late']);
    expect(titles(b.fatalToday)).toEqual(['today']);
    expect(titles(b.hearingsToday)).toEqual(['hear']);
    expect(titles(b.nextTwoDays)).toEqual(['next']);
  });

  it('same clock in Tokyo is already 2026-10-27', async () => {
    const { fakes, get } = setup('2026-10-27T01:30:00Z');
    fakes.setProfile(U1, { timezone: 'Asia/Tokyo' });
    await fakes.tasks.create(U1, task('late', { dueDate: '2026-10-26' }));
    await fakes.tasks.create(U1, task('today', { dueDate: '2026-10-27', fatal: true }));
    await fakes.tasks.create(U1, task('next', { dueDate: '2026-10-29' }));
    const b = await get(U1);
    expect(b.today).toBe('2026-10-27');
    expect(titles(b.overdue)).toEqual(['late']);
    expect(titles(b.fatalToday)).toEqual(['today']);
    expect(titles(b.nextTwoDays)).toEqual(['next']);
  });

  it("uses only the token user's tasks and profile", async () => {
    const { fakes, get } = setup('2026-10-27T01:30:00Z');
    fakes.setProfile(U1, { timezone: 'America/Sao_Paulo' });
    fakes.setProfile(U2, { timezone: 'Asia/Tokyo' });
    await fakes.tasks.create(U1, task('mine', { dueDate: '2026-10-26', fatal: true }));
    await fakes.tasks.create(U2, task('theirs', { dueDate: '2026-10-26', fatal: true }));
    const b = await get(U1);
    expect(b.today).toBe('2026-10-26');
    expect(titles(b.fatalToday)).toEqual(['mine']);
  });
});
