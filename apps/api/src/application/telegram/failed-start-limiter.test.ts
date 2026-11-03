import { describe, expect, it } from 'vitest';
import { createFailedStartLimiter } from './failed-start-limiter.js';

const T0 = new Date('2026-10-26T12:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('createFailedStartLimiter', () => {
  it('allows 5 failures and blocks from the 6th attempt on', () => {
    const l = createFailedStartLimiter({ max: 5, windowMs: 10 * 60_000 });
    for (let i = 0; i < 5; i++) {
      expect(l.allow(1, at(i))).toBe(true);
      l.recordFailure(1, at(i));
    }
    expect(l.allow(1, at(10))).toBe(false);
  });

  it('does not affect other chats', () => {
    const l = createFailedStartLimiter({ max: 5, windowMs: 10 * 60_000 });
    for (let i = 0; i < 5; i++) l.recordFailure(1, at(i));
    expect(l.allow(1, at(10))).toBe(false);
    expect(l.allow(2, at(10))).toBe(true);
  });

  it('is a sliding window: a failure expires exactly windowMs later', () => {
    const l = createFailedStartLimiter({ max: 2, windowMs: 1000 });
    l.recordFailure(1, at(0));
    l.recordFailure(1, at(500));
    expect(l.allow(1, at(999))).toBe(false);
    expect(l.allow(1, at(1000))).toBe(true);
    l.recordFailure(1, at(1000));
    expect(l.allow(1, at(1001))).toBe(false);
    expect(l.allow(1, at(1500))).toBe(true);
  });

  it('prunes expired chats so memory does not grow unbounded', () => {
    const l = createFailedStartLimiter({ max: 5, windowMs: 1000 });
    for (let c = 0; c < 1000; c++) l.recordFailure(c, at(0));
    l.recordFailure(99999, at(5000));
    expect(l.size()).toBeLessThan(10);
  });

  it('caps the number of tracked chats', () => {
    const l = createFailedStartLimiter({ max: 5, windowMs: 10 * 60_000, maxChats: 100 });
    for (let c = 0; c < 500; c++) l.recordFailure(c, at(c));
    expect(l.size()).toBeLessThanOrEqual(100);
  });
});
