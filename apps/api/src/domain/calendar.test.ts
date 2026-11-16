import type { IsoDate } from '@nexus/shared';
import { describe, expect, it } from 'vitest';
import { addDays } from './calendar.js';

const d = (s: string): IsoDate => s as IsoDate;

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
