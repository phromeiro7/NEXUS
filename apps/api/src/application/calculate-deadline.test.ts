import { describe, expect, it } from 'vitest';
import type { Holiday, IsoDate } from '@nexus/shared';
import type { HolidayRepository } from './ports.js';
import { makeCalculateDeadline } from './calculate-deadline.js';

const d = (s: string) => s as IsoDate;

function fakeRepo(rows: Holiday[] = []) {
  const calls: { userId: string; from: IsoDate; to: IsoDate }[] = [];
  const repo: HolidayRepository = {
    async listByUser(userId, from, to) {
      calls.push({ userId, from, to });
      return rows.filter((h) => h.date >= from && h.date <= to);
    },
  };
  return { repo, calls };
}

describe('makeCalculateDeadline', () => {
  it('counts national holidays (Finados) for 15 business days', async () => {
    const { repo } = fakeRepo();
    const out = await makeCalculateDeadline({ holidays: repo })('u1', {
      baseDate: d('2026-10-26'), days: 15, countType: 'uteis',
    });
    expect(out.dueDate).toBe('2026-11-17');
    expect(out.prorrogado).toBe(false);
    expect(out.feriadosDescontados).toEqual([{ date: '2026-11-02', name: 'Finados' }]);
  });

  it('includes the user state holiday', async () => {
    const { repo } = fakeRepo([{ date: d('2026-11-05'), name: 'Feriado estadual' }]);
    const out = await makeCalculateDeadline({ holidays: repo })('u1', {
      baseDate: d('2026-10-26'), days: 15, countType: 'uteis',
    });
    expect(out.dueDate).toBe('2026-11-18');
    expect(out.feriadosDescontados).toContainEqual({ date: '2026-11-05', name: 'Feriado estadual' });
  });

  it('uses next year national holidays when the deadline crosses the year', async () => {
    const { repo } = fakeRepo();
    const out = await makeCalculateDeadline({ holidays: repo })('u1', {
      baseDate: d('2026-12-29'), days: 5, countType: 'uteis',
    });
    expect(out.dueDate).toBe('2027-01-06');
    expect(out.feriadosDescontados).toContainEqual({ date: '2027-01-01', name: 'Confraternização Universal' });
  });

  it('passes the caller userId to the repository, with a span covering the deadline', async () => {
    const { repo, calls } = fakeRepo();
    await makeCalculateDeadline({ holidays: repo })('user-xyz', {
      baseDate: d('2026-10-26'), days: 15, countType: 'uteis',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.userId).toBe('user-xyz');
    expect(calls[0]!.from <= '2026-10-26').toBe(true);
    expect(calls[0]!.to >= '2026-11-17').toBe(true);
  });

  it('reports the national name once when user and national holidays share a date', async () => {
    const { repo } = fakeRepo([{ date: d('2026-11-02'), name: 'Meu Finados' }]);
    const out = await makeCalculateDeadline({ holidays: repo })('u1', {
      baseDate: d('2026-10-26'), days: 15, countType: 'uteis',
    });
    expect(out.dueDate).toBe('2026-11-17');
    expect(out.feriadosDescontados.filter((h) => h.date === '2026-11-02')).toEqual([
      { date: '2026-11-02', name: 'Finados' },
    ]);
  });

  it('ignores user holidays outside the span', async () => {
    const { repo } = fakeRepo([{ date: d('2030-01-10'), name: 'Longe' }]);
    const out = await makeCalculateDeadline({ holidays: repo })('u1', {
      baseDate: d('2026-10-26'), days: 15, countType: 'uteis',
    });
    expect(out.feriadosDescontados.map((h) => h.name)).not.toContain('Longe');
  });

  it('flags prorrogado for corridos ending on a non-business day', async () => {
    const { repo } = fakeRepo();
    const out = await makeCalculateDeadline({ holidays: repo })('u1', {
      baseDate: d('2026-10-26'), days: 6, countType: 'corridos', // 2026-11-01 is Sunday
    });
    expect(out.dueDate).toBe('2026-11-03');
    expect(out.prorrogado).toBe(true);
  });

  // Callers other than the HTTP route (AI tools, bot, jobs) skip the zod schema;
  // Infinity used to hang the year loop.
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 366])(
    'rejects days=%s with RangeError without calling the repository',
    async (days) => {
      const { repo, calls } = fakeRepo();
      await expect(
        makeCalculateDeadline({ holidays: repo })('u1', { baseDate: d('2026-10-26'), days, countType: 'uteis' }),
      ).rejects.toThrow(RangeError);
      expect(calls).toHaveLength(0);
    },
  );
});
