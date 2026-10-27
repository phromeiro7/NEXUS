import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  formatLongDate,
  formatShort,
  monthGrid,
  monthRange,
  parseAnchor,
  todayIn,
  weekRange,
} from './dates';

describe('todayIn', () => {
  const now = new Date('2026-10-27T02:30:00Z');
  it('uses the given time zone', () => {
    expect(todayIn('America/Sao_Paulo', now)).toBe('2026-10-26');
    expect(todayIn('Asia/Tokyo', now)).toBe('2026-10-27');
  });
  it('throws on invalid time zone', () => {
    expect(() => todayIn('Nope/Zone', now)).toThrow();
  });
});

describe('addDays', () => {
  it('crosses year, leap day and month boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('weekRange', () => {
  it('runs Monday to Sunday', () => {
    expect(weekRange('2026-10-25')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(weekRange('2026-12-30')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
    expect(weekRange('2026-10-26')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  });
});

describe('monthGrid', () => {
  it('handles a month starting on Sunday', () => {
    const g = monthGrid(2026, 2);
    expect(g).toHaveLength(5);
    expect(g[0]![0]).toBe('2026-01-26');
    expect(g[4]![6]).toBe('2026-03-01');
  });
  it('contains leap day', () => {
    expect(monthGrid(2028, 2).flat()).toContain('2028-02-29');
  });
  it('has consecutive 7-day rows', () => {
    for (const [y, m] of [[2026, 2], [2028, 2], [2026, 10], [2026, 12]] as const) {
      const g = monthGrid(y, m);
      for (const row of g) expect(row).toHaveLength(7);
      const flat = g.flat();
      flat.forEach((d, i) => {
        if (i > 0) expect(d).toBe(addDays(flat[i - 1]!, 1));
      });
    }
  });
  it('has 4 rows for a Monday-start 28-day month', () => {
    // Feb 2027 starts on Monday and has 28 days.
    const g = monthGrid(2027, 2);
    expect(g).toHaveLength(4);
    expect(g[0]![0]).toBe('2027-02-01');
    expect(g[3]![6]).toBe('2027-02-28');
  });
  it('has 6 rows when needed', () => {
    // Aug 2026 starts on Saturday and has 31 days.
    const g = monthGrid(2026, 8);
    expect(g).toHaveLength(6);
    expect(g[0]![0]).toBe('2026-07-27');
    expect(g[5]![6]).toBe('2026-09-06');
  });
});

describe('monthRange', () => {
  it('returns first and last day', () => {
    expect(monthRange(2028, 2)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange(2026, 12)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('formatting', () => {
  it('formats long date in pt-BR', () => {
    expect(formatLongDate('2026-10-26')).toBe('segunda-feira, 26 de outubro de 2026');
    expect(formatLongDate('2026-03-01')).toBe('domingo, 1 de março de 2026');
  });
  it('formats short date', () => {
    expect(formatShort('2026-10-26')).toBe('26/10');
    expect(formatShort('2026-03-01')).toBe('01/03');
  });
});

describe('daysBetween', () => {
  it('counts days, negative when reversed', () => {
    expect(daysBetween('2026-10-26', '2026-10-29')).toBe(3);
    expect(daysBetween('2026-10-29', '2026-10-26')).toBe(-3);
  });
  it('is unaffected by DST dates', () => {
    expect(daysBetween('2026-10-01', '2026-11-01')).toBe(31);
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });
});

describe('parseAnchor', () => {
  it('aceita datas reais e rejeita o resto', () => {
    expect(parseAnchor('2026-02-11')).toBe('2026-02-11');
    expect(parseAnchor('2026-02-30')).toBeNull();
    expect(parseAnchor('2026-2-1')).toBeNull();
    expect(parseAnchor(null)).toBeNull();
  });
});
