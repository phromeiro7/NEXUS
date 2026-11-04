import { describe, expect, it } from 'vitest';
import { captureProposalSchema, interpretCaptureInputSchema, CAPTURE_TEXT_MAX } from './capture-api.js';

describe('interpretCaptureInputSchema', () => {
  it('trims and requires text', () => {
    expect(interpretCaptureInputSchema.parse({ text: '  gastei 100 em roupa  ' })).toEqual({ text: 'gastei 100 em roupa' });
    expect(interpretCaptureInputSchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(interpretCaptureInputSchema.safeParse({}).success).toBe(false);
  });
  it('bounds the length', () => {
    expect(interpretCaptureInputSchema.safeParse({ text: 'a'.repeat(CAPTURE_TEXT_MAX) }).success).toBe(true);
    expect(interpretCaptureInputSchema.safeParse({ text: 'a'.repeat(CAPTURE_TEXT_MAX + 1) }).success).toBe(false);
  });
});

describe('captureProposalSchema', () => {
  it('accepts a money proposal and a task proposal', () => {
    expect(
      captureProposalSchema.safeParse({
        kind: 'gasto',
        description: 'roupa',
        amountCents: 10000,
        category: 'Roupas',
        date: '2026-11-04',
        time: null,
        status: 'paga',
      }).success,
    ).toBe(true);
    expect(
      captureProposalSchema.safeParse({ kind: 'tarefa', title: 'ligar pra vidinha', date: '2026-11-04', time: '14:00', vagueTime: false })
        .success,
    ).toBe(true);
  });
  it('rejects a zero amount and a bad date', () => {
    expect(
      captureProposalSchema.safeParse({ kind: 'gasto', description: 'x', amountCents: 0, category: null, date: null, time: null, status: 'paga' })
        .success,
    ).toBe(false);
    expect(captureProposalSchema.safeParse({ kind: 'tarefa', title: 'x', date: '04/11', time: null, vagueTime: false }).success).toBe(false);
  });
});
