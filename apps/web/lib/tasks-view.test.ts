import { describe, expect, it } from 'vitest';
import type { IsoDate, TaskDto } from '@nexus/shared';
import {
  countByDay,
  groupDay,
  groupHistory,
  groupWeek,
  pendingCount,
  urgencyLabel,
} from './tasks-view';

const TODAY = '2026-10-27' as IsoDate;

let seq = 0;
function task(over: Partial<TaskDto> = {}): TaskDto {
  seq += 1;
  return {
    id: `t${seq}`,
    caseId: null,
    title: `Tarefa ${seq}`,
    type: 'tarefa',
    status: 'pendente',
    dueDate: TODAY,
    dueTime: null,
    fatal: false,
    baseDate: null,
    periodDays: null,
    countType: null,
    completedAt: null,
    createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-01T12:00:00Z',
    ...over,
  };
}

const ids = (ts: TaskDto[]) => ts.map((t) => t.id);

describe('groupDay', () => {
  it('puts yesterday task in overdue', () => {
    const late = task({ id: 'late', dueDate: '2026-10-26' as IsoDate });
    expect(ids(groupDay([late], TODAY).overdue)).toEqual(['late']);
  });

  it('orders overdue by date then time (no time last)', () => {
    const a = task({ id: 'a', dueDate: '2026-10-26' as IsoDate, dueTime: '15:00' });
    const b = task({ id: 'b', dueDate: '2026-10-25' as IsoDate });
    const c = task({ id: 'c', dueDate: '2026-10-26' as IsoDate, dueTime: '08:00' });
    const d = task({ id: 'd', dueDate: '2026-10-26' as IsoDate });
    expect(ids(groupDay([a, b, c, d], TODAY).overdue)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('shows a fatal task due today only in fatalToday', () => {
    const f = task({ id: 'f', fatal: true, dueTime: '10:00' });
    const g = task({ id: 'g', fatal: true });
    const r = groupDay([f, g], TODAY);
    expect(ids(r.fatalToday)).toEqual(['f', 'g']);
    expect(r.timed).toEqual([]);
    expect(r.dateOnly).toEqual([]);
  });

  it('orders 09:00 before 14:00 in timed', () => {
    const late = task({ id: 'p14', dueTime: '14:00' });
    const early = task({ id: 'p09', dueTime: '09:00' });
    expect(ids(groupDay([late, early], TODAY).timed)).toEqual(['p09', 'p14']);
  });

  it('separates dateOnly and undated', () => {
    const d = task({ id: 'd' });
    const u = task({ id: 'u', dueDate: null });
    const r = groupDay([d, u], TODAY);
    expect(ids(r.dateOnly)).toEqual(['d']);
    expect(ids(r.undated)).toEqual(['u']);
  });

  it('excludes closed tasks and future tasks from every group', () => {
    const done = task({ status: 'concluida', completedAt: '2026-10-27T12:00:00Z' });
    const cancelled = task({ status: 'cancelada', dueDate: '2026-10-20' as IsoDate });
    const future = task({ dueDate: '2026-10-28' as IsoDate });
    const r = groupDay([done, cancelled, future], TODAY);
    expect(Object.values(r).flat()).toEqual([]);
  });

  it('treats em_andamento as open', () => {
    const t = task({ id: 'w', status: 'em_andamento' });
    expect(ids(groupDay([t], TODAY).dateOnly)).toEqual(['w']);
  });
});

describe('groupWeek', () => {
  const from = '2026-10-26' as IsoDate;

  it('always returns 7 consecutive columns', () => {
    const cols = groupWeek([], from);
    expect(cols.map((c) => c.date)).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
    expect(cols.every((c) => c.tasks.length === 0)).toBe(true);
  });

  it('orders timed tasks by time, then date-only tasks', () => {
    const noTime = task({ id: 'n', dueDate: TODAY });
    const t14 = task({ id: 't14', dueDate: TODAY, dueTime: '14:00' });
    const t09 = task({ id: 't09', dueDate: TODAY, dueTime: '09:00' });
    const col = groupWeek([noTime, t14, t09], from).find((c) => c.date === TODAY)!;
    expect(ids(col.tasks)).toEqual(['t09', 't14', 'n']);
  });

  it('ignores closed, undated and out-of-range tasks', () => {
    const done = task({ status: 'concluida' });
    const undated = task({ dueDate: null });
    const outside = task({ dueDate: '2026-11-02' as IsoDate });
    const cols = groupWeek([done, undated, outside], from);
    expect(cols.flatMap((c) => c.tasks)).toEqual([]);
  });
});

describe('countByDay', () => {
  it('counts open tasks and fatals, ignoring concluida/cancelada and undated', () => {
    const r = countByDay([
      task({ dueDate: TODAY }),
      task({ dueDate: TODAY, fatal: true }),
      task({ dueDate: TODAY, status: 'concluida' }),
      task({ dueDate: TODAY, status: 'cancelada', fatal: true }),
      task({ dueDate: '2026-10-28' as IsoDate, status: 'em_andamento' }),
      task({ dueDate: null }),
    ]);
    expect(r).toEqual({
      '2026-10-27': { total: 2, fatal: 1 },
      '2026-10-28': { total: 1, fatal: 0 },
    });
  });
});

describe('urgencyLabel', () => {
  it('labels overdue (plural and singular)', () => {
    expect(urgencyLabel(task({ dueDate: '2026-10-25' as IsoDate }), TODAY)).toBe(
      'atrasada há 2 dias',
    );
    expect(urgencyLabel(task({ dueDate: '2026-10-26' as IsoDate }), TODAY)).toBe(
      'atrasada há 1 dia',
    );
  });

  it('labels today, tomorrow and future', () => {
    expect(urgencyLabel(task({ dueDate: TODAY }), TODAY)).toBe('vence hoje');
    expect(urgencyLabel(task({ dueDate: '2026-10-28' as IsoDate }), TODAY)).toBe('vence amanhã');
    expect(urgencyLabel(task({ dueDate: '2026-11-01' as IsoDate }), TODAY)).toBe('em 5 dias');
  });

  it('labels undated and closed tasks', () => {
    expect(urgencyLabel(task({ dueDate: null }), TODAY)).toBe('sem data');
    expect(urgencyLabel(task({ status: 'concluida' }), TODAY)).toBe('concluída');
    expect(urgencyLabel(task({ status: 'cancelada', dueDate: null }), TODAY)).toBe('cancelada');
  });
});

describe('pendingCount', () => {
  it('counts open tasks due today or earlier', () => {
    expect(
      pendingCount(
        [
          task({ dueDate: '2026-10-20' as IsoDate }),
          task({ dueDate: TODAY }),
          task({ dueDate: '2026-10-28' as IsoDate }),
          task({ dueDate: null }),
          task({ dueDate: TODAY, status: 'concluida' }),
        ],
        TODAY,
      ),
    ).toBe(2);
  });
});

describe('groupHistory', () => {
  const SP = 'America/Sao_Paulo';

  it('converts completedAt to the time zone day', () => {
    const t = task({ id: 'h', status: 'concluida', completedAt: '2026-10-27T02:30:00Z' });
    expect(groupHistory([t], { timeZone: SP })).toEqual([{ day: '2026-10-26', tasks: [t] }]);
  });

  it('orders days newest first', () => {
    const a = task({ id: 'a', status: 'concluida', completedAt: '2026-10-20T15:00:00Z' });
    const b = task({ id: 'b', status: 'concluida', completedAt: '2026-10-25T15:00:00Z' });
    const c = task({ id: 'c', status: 'concluida', completedAt: '2026-10-25T18:00:00Z' });
    const r = groupHistory([a, b, c], { timeZone: SP });
    expect(r.map((g) => g.day)).toEqual(['2026-10-25', '2026-10-20']);
    expect(ids(r[0]!.tasks)).toEqual(['c', 'b']);
  });

  it('excludes cancelled by default and includes them with includeCancelled', () => {
    const done = task({ id: 'd', status: 'concluida', completedAt: '2026-10-25T15:00:00Z' });
    const canc = task({
      id: 'x',
      status: 'cancelada',
      completedAt: null,
      updatedAt: '2026-10-26T15:00:00Z',
    });
    const open = task({ id: 'o' });
    expect(groupHistory([done, canc, open], { timeZone: SP }).flatMap((g) => ids(g.tasks))).toEqual(
      ['d'],
    );
    const r = groupHistory([done, canc, open], { timeZone: SP, includeCancelled: true });
    expect(r.map((g) => g.day)).toEqual(['2026-10-26', '2026-10-25']);
    expect(ids(r[0]!.tasks)).toEqual(['x']);
  });

  it('orders by instant, not by raw string, when timestamp formats differ', () => {
    // Same day in SP; as strings "…15:00:00Z" < "…15:00:00.500Z" is false ("Z" > "."),
    // yet the second instant is later.
    const a = task({ id: 'a', status: 'concluida', completedAt: '2026-10-26T15:00:00Z' });
    const b = task({ id: 'b', status: 'concluida', completedAt: '2026-10-26T15:00:00.500Z' });
    expect(ids(groupHistory([a, b], { timeZone: SP })[0]!.tasks)).toEqual(['b', 'a']);
  });
});
