import { describe, expect, it } from 'vitest';
import { createHolidayInputSchema } from './holiday-api.js';

const ok = { date: '2026-12-08', scope: 'municipal', name: 'Padroeira' };

describe('createHolidayInputSchema', () => {
  it('accepts a valid holiday and trims the name', () => {
    expect(createHolidayInputSchema.parse({ ...ok, name: ' Padroeira ' }).name).toBe('Padroeira');
    expect(createHolidayInputSchema.safeParse({ ...ok, scope: 'estadual' }).success).toBe(true);
  });
  it('rejects bad scope, date and name', () => {
    expect(createHolidayInputSchema.safeParse({ ...ok, scope: 'nacional' }).success).toBe(false);
    expect(createHolidayInputSchema.safeParse({ ...ok, date: '2026-02-31' }).success).toBe(false);
    expect(createHolidayInputSchema.safeParse({ ...ok, name: '' }).success).toBe(false);
    expect(createHolidayInputSchema.safeParse({ ...ok, name: 'a'.repeat(101) }).success).toBe(false);
  });
});
