import { describe, expect, it } from 'vitest';
import { createCaseInputSchema, updateCaseInputSchema } from './case-api.js';

describe('createCaseInputSchema', () => {
  it('rejects an empty number, trims a valid one', () => {
    expect(createCaseInputSchema.safeParse({ number: '' }).success).toBe(false);
    expect(createCaseInputSchema.parse({ number: ' 0001 ' }).number).toBe('0001');
  });
  it('enforces length limits', () => {
    expect(createCaseInputSchema.safeParse({ number: 'a'.repeat(61) }).success).toBe(false);
    expect(createCaseInputSchema.safeParse({ number: '1', clientName: 'a'.repeat(201) }).success).toBe(false);
    expect(createCaseInputSchema.safeParse({ number: '1', description: 'a'.repeat(1001) }).success).toBe(false);
    expect(createCaseInputSchema.safeParse({ number: '1', clientName: null, description: null }).success).toBe(true);
  });
});

describe('updateCaseInputSchema', () => {
  it('requires at least one field', () => {
    expect(updateCaseInputSchema.safeParse({}).success).toBe(false);
  });
  it('validates status', () => {
    expect(updateCaseInputSchema.safeParse({ status: 'arquivado' }).success).toBe(true);
    expect(updateCaseInputSchema.safeParse({ status: 'x' }).success).toBe(false);
  });
});
