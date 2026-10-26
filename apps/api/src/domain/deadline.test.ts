import type { IsoDate } from '@aj/shared';
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
