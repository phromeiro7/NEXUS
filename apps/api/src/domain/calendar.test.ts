import type { IsoDate } from '@aj/shared';
import { describe, expect, it } from 'vitest';
import { addDays, isBusinessDay, nextBusinessDay } from './calendar.js';

const d = (s: string): IsoDate => s as IsoDate;
const none: ReadonlySet<IsoDate> = new Set();

describe('addDays', () => {
  it('crosses the 2028 leap day', () => {
    expect(addDays(d('2028-02-28'), 1)).toBe('2028-02-29');
    expect(addDays(d('2028-02-29'), 1)).toBe('2028-03-01');
  });
  it('crosses the year boundary', () => {
    expect(addDays(d('2027-12-31'), 1)).toBe('2028-01-01');
  });
  it('subtracts days and accepts zero', () => {
    expect(addDays(d('2028-03-01'), -1)).toBe('2028-02-29');
    expect(addDays(d('2026-10-26'), 0)).toBe('2026-10-26');
  });
});

describe('isBusinessDay', () => {
  it('is false on Saturday', () => {
    expect(isBusinessDay(d('2026-10-31'), none)).toBe(false);
  });
  it('is false on Sunday', () => {
    expect(isBusinessDay(d('2026-11-01'), none)).toBe(false);
  });
  it('is false on a holiday', () => {
    expect(isBusinessDay(d('2026-11-02'), new Set([d('2026-11-02')]))).toBe(false);
  });
  it('is true on a regular weekday', () => {
    expect(isBusinessDay(d('2026-10-26'), none)).toBe(true);
  });
});

describe('nextBusinessDay', () => {
  it('returns the same day when already a business day', () => {
    expect(nextBusinessDay(d('2026-10-26'), none)).toBe('2026-10-26');
  });
  it('skips weekend and holiday', () => {
    expect(nextBusinessDay(d('2026-10-31'), new Set([d('2026-11-02')]))).toBe('2026-11-03');
  });
});
