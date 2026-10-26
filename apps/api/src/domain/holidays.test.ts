import { describe, expect, it } from 'vitest';
import { easterSunday, nationalHolidays } from './holidays.js';

describe('easterSunday', () => {
  it.each([
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
  ])('year %i', (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });
});

describe('nationalHolidays', () => {
  const list = nationalHolidays(2026);
  const dates = list.map((h) => h.date);

  it('has 10 items including the movable and key fixed ones', () => {
    expect(list).toHaveLength(10);
    expect(dates).toContain('2026-04-03');
    expect(dates).toContain('2026-11-20');
    expect(dates).toContain('2026-11-02');
  });

  it('is sorted by date', () => {
    expect(dates).toEqual([...dates].sort());
  });

  it('moves Good Friday with Easter and crosses month boundaries', () => {
    expect(nationalHolidays(2027).map((h) => h.date)).toContain('2027-03-26');
  });

  it('excludes Carnival and Corpus Christi', () => {
    expect(dates).not.toContain('2026-02-17');
    expect(dates).not.toContain('2026-06-04');
  });
});
