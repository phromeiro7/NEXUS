import { describe, expect, it } from 'vitest';
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
