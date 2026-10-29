import { describe, expect, it } from 'vitest';
import { todayIn } from './time.js';

describe('todayIn', () => {
  it('uses the given time zone, not UTC', () => {
    expect(todayIn('America/Sao_Paulo', new Date('2026-10-27T01:30:00Z'))).toBe('2026-10-26');
  });
});
