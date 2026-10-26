import { describe, expect, it } from 'vitest';
import { calculateDeadlineInputSchema } from './deadline.js';

const parse = (input: Record<string, unknown>) =>
  calculateDeadlineInputSchema.safeParse({ baseDate: '2026-10-26', days: 15, countType: 'uteis', ...input });

describe('calculateDeadlineInputSchema', () => {
  it.each([0, -3, 2.5, 366, Number.NaN])('rejects days=%s', (days) => {
    expect(parse({ days }).success).toBe(false);
  });

  it.each([1, 365])('accepts days=%s', (days) => {
    expect(parse({ days }).success).toBe(true);
  });

  it.each(['uteis', 'corridos'])('accepts countType=%s', (countType) => {
    const r = parse({ countType });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ baseDate: '2026-10-26', days: 15, countType });
  });

  it('rejects an unknown countType', () => {
    expect(parse({ countType: 'dias' }).success).toBe(false);
  });

  it.each(['2026-02-31', '26-10-2026', '2026-10-26T00:00:00Z', ''])('rejects baseDate=%j', (baseDate) => {
    expect(parse({ baseDate }).success).toBe(false);
  });
});
