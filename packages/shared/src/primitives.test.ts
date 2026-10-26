import { describe, expect, it } from 'vitest';
import { calculateDeadlineInputSchema } from './deadline.js';
import { isoDateSchema } from './primitives.js';

describe('isoDateSchema', () => {
  it('rejects non-existent dates', () => {
    expect(isoDateSchema.safeParse('2026-02-31').success).toBe(false);
    expect(isoDateSchema.safeParse('2027-02-29').success).toBe(false);
  });
  it('accepts leap day', () => {
    expect(isoDateSchema.safeParse('2028-02-29').success).toBe(true);
  });
});

describe('calculateDeadlineInputSchema', () => {
  it.each([0, -3, 2.5, 366])('rejects days=%s', (days) => {
    const r = calculateDeadlineInputSchema.safeParse({ baseDate: '2026-10-26', days, countType: 'uteis' });
    expect(r.success).toBe(false);
  });
  it('accepts a valid input', () => {
    const r = calculateDeadlineInputSchema.safeParse({ baseDate: '2026-10-26', days: 15, countType: 'corridos' });
    expect(r.success).toBe(true);
  });
});
