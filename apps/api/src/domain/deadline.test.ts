import type { IsoDate } from '@nexus/shared';
import { describe, expect, it } from 'vitest';
import { calculateDeadline } from './deadline.js';

const d = (s: string): IsoDate => s as IsoDate;
const set = (...s: string[]): ReadonlySet<IsoDate> => new Set(s.map(d));
const none = set();
const finados = set('2026-11-02');

describe('calculateDeadline uteis', () => {
  it('counts 15 business days skipping Finados', () => {
    expect(
      calculateDeadline({ baseDate: d('2026-10-26'), days: 15, countType: 'uteis', holidays: finados }),
    ).toEqual({ dueDate: '2026-11-17', prorrogado: false, feriadosDescontados: ['2026-11-02'] });
  });
  it('starts counting after a Saturday publication', () => {
    expect(
      calculateDeadline({ baseDate: d('2026-10-31'), days: 5, countType: 'uteis', holidays: finados }).dueDate,
    ).toBe('2026-11-09');
  });
  it('crosses the year boundary', () => {
    expect(
      calculateDeadline({ baseDate: d('2027-12-29'), days: 5, countType: 'uteis', holidays: none }).dueDate,
    ).toBe('2028-01-05');
  });
  it('crosses the 2028 leap day', () => {
    expect(
      calculateDeadline({ baseDate: d('2028-02-28'), days: 1, countType: 'uteis', holidays: none }),
    ).toEqual({ dueDate: '2028-02-29', prorrogado: false, feriadosDescontados: [] });
  });
  it('does not list a holiday that falls on a weekend', () => {
    expect(
      calculateDeadline({
        baseDate: d('2026-10-28'),
        days: 3,
        countType: 'uteis',
        holidays: set('2026-10-31'),
      }),
    ).toEqual({ dueDate: '2026-11-02', prorrogado: false, feriadosDescontados: [] });
  });
});

describe('calculateDeadline corridos', () => {
  it('prorroga to the next business day when due falls on a weekend', () => {
    expect(
      calculateDeadline({ baseDate: d('2026-10-28'), days: 3, countType: 'corridos', holidays: finados }),
    ).toEqual({ dueDate: '2026-11-03', prorrogado: true, feriadosDescontados: ['2026-11-02'] });
  });
  it('does not prorroga when due lands on a business day', () => {
    expect(
      calculateDeadline({
        baseDate: d('2026-10-28'),
        days: 2,
        countType: 'corridos',
        holidays: set('2026-10-29'),
      }),
    ).toEqual({ dueDate: '2026-10-30', prorrogado: false, feriadosDescontados: ['2026-10-29'] });
  });
  it('excludes a weekend holiday from feriadosDescontados', () => {
    expect(
      calculateDeadline({
        baseDate: d('2026-10-28'),
        days: 3,
        countType: 'corridos',
        holidays: set('2026-10-31'),
      }),
    ).toEqual({ dueDate: '2026-11-02', prorrogado: true, feriadosDescontados: [] });
  });
});

describe('calculateDeadline days guard', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 366])('throws RangeError for days=%s', (days) => {
    expect(() =>
      calculateDeadline({ baseDate: d('2026-10-26'), days, countType: 'uteis', holidays: none }),
    ).toThrow(RangeError);
    expect(() =>
      calculateDeadline({ baseDate: d('2026-10-26'), days, countType: 'corridos', holidays: none }),
    ).toThrow(RangeError);
  });
  it('accepts the bounds 1 and 365', () => {
    expect(
      calculateDeadline({ baseDate: d('2026-10-26'), days: 1, countType: 'uteis', holidays: none }).dueDate,
    ).toBe('2026-10-27');
    expect(
      calculateDeadline({ baseDate: d('2026-10-26'), days: 365, countType: 'corridos', holidays: none }).dueDate,
    ).toBe('2027-10-26');
  });
});

describe('calculateDeadline with a non-business baseDate', () => {
  // 2026-11-01 is a Sunday; 2026-11-02 (Finados) is a Monday.
  it('uteis from a Sunday starts counting on the next business day', () => {
    // Mon 02, Tue 03, Wed 04, Thu 05, Fri 06.
    expect(
      calculateDeadline({ baseDate: d('2026-11-01'), days: 5, countType: 'uteis', holidays: none }),
    ).toEqual({ dueDate: '2026-11-06', prorrogado: false, feriadosDescontados: [] });
  });
  it('uteis from a Sunday also skips a Monday holiday', () => {
    // 02 is Finados: Tue 03, Wed 04, Thu 05, Fri 06, Mon 09.
    expect(
      calculateDeadline({ baseDate: d('2026-11-01'), days: 5, countType: 'uteis', holidays: finados }),
    ).toEqual({ dueDate: '2026-11-09', prorrogado: false, feriadosDescontados: ['2026-11-02'] });
  });
  it('uteis from a weekday holiday excludes the start day and does not list it', () => {
    // Base is Finados itself: Tue 03, Wed 04, Thu 05, Fri 06, Mon 09.
    expect(
      calculateDeadline({ baseDate: d('2026-11-02'), days: 5, countType: 'uteis', holidays: finados }),
    ).toEqual({ dueDate: '2026-11-09', prorrogado: false, feriadosDescontados: [] });
  });
  it('corridos from a weekday holiday counts from the next day and does not list it', () => {
    // 02 + 3 = Thu 05, a business day.
    expect(
      calculateDeadline({ baseDate: d('2026-11-02'), days: 3, countType: 'corridos', holidays: finados }),
    ).toEqual({ dueDate: '2026-11-05', prorrogado: false, feriadosDescontados: [] });
  });
});
