import { describe, expect, it } from 'vitest';
import { createTaskInputSchema, listTasksQuerySchema, updateTaskInputSchema } from './task-api.js';

const deadline = { baseDate: '2026-10-26', days: 15, countType: 'uteis' };

describe('createTaskInputSchema', () => {
  it('trims the title and applies defaults (type stays undefined)', () => {
    const r = createTaskInputSchema.safeParse({ title: '  Contestação  ' });
    expect(r.success).toBe(true);
    expect(r.data?.title).toBe('Contestação');
    expect(r.data?.type).toBeUndefined();
    expect(r.data?.fatal).toBe(false);
    expect(r.data?.caseId).toBeNull();
  });

  it('rejects empty and 201-char titles, accepts 200', () => {
    expect(createTaskInputSchema.safeParse({ title: '' }).success).toBe(false);
    expect(createTaskInputSchema.safeParse({ title: 'a'.repeat(201) }).success).toBe(false);
    expect(createTaskInputSchema.safeParse({ title: 'a'.repeat(200) }).success).toBe(true);
  });

  it('requires a date for dueTime', () => {
    expect(createTaskInputSchema.safeParse({ title: 'x', dueTime: '09:00' }).success).toBe(false);
    expect(createTaskInputSchema.safeParse({ title: 'x', dueTime: '09:00', dueDate: '2026-10-26' }).success).toBe(true);
    expect(createTaskInputSchema.safeParse({ title: 'x', dueTime: '09:00', deadline }).success).toBe(true);
  });

  it('rejects dueDate together with deadline', () => {
    expect(createTaskInputSchema.safeParse({ title: 'x', dueDate: '2026-10-26', deadline }).success).toBe(false);
  });

  it('accepts a deadline alone, rejects days 0 and impossible dates', () => {
    expect(createTaskInputSchema.safeParse({ title: 'x', deadline }).success).toBe(true);
    expect(createTaskInputSchema.safeParse({ title: 'x', deadline: { ...deadline, days: 0 } }).success).toBe(false);
    expect(createTaskInputSchema.safeParse({ title: 'x', dueDate: '2026-02-31' }).success).toBe(false);
  });

  it('validates caseId as uuid', () => {
    expect(createTaskInputSchema.safeParse({ title: 'x', caseId: 'nope' }).success).toBe(false);
    expect(
      createTaskInputSchema.safeParse({ title: 'x', caseId: '3f2b8c1e-5d4a-4b6e-9c7d-1a2b3c4d5e6f' }).success,
    ).toBe(true);
  });
});

describe('updateTaskInputSchema', () => {
  it('rejects an empty object', () => {
    expect(updateTaskInputSchema.safeParse({}).success).toBe(false);
  });
  it('validates status', () => {
    expect(updateTaskInputSchema.safeParse({ status: 'concluida' }).success).toBe(true);
    expect(updateTaskInputSchema.safeParse({ status: 'feito' }).success).toBe(false);
  });
  it('rejects dueDate together with deadline', () => {
    expect(updateTaskInputSchema.safeParse({ dueDate: '2026-10-26', deadline }).success).toBe(false);
    expect(updateTaskInputSchema.safeParse({ deadline }).success).toBe(true);
  });
});

describe('listTasksQuerySchema', () => {
  it('splits a comma-separated status', () => {
    expect(listTasksQuerySchema.parse({ status: 'pendente,em_andamento' }).status).toEqual(['pendente', 'em_andamento']);
  });
  it('accepts a repeated status list and rejects invalid values', () => {
    expect(listTasksQuerySchema.parse({ status: ['pendente', 'concluida'] }).status).toEqual(['pendente', 'concluida']);
    expect(listTasksQuerySchema.safeParse({ status: 'pendente,feito' }).success).toBe(false);
  });
  it('rejects from > to, accepts from <= to', () => {
    expect(listTasksQuerySchema.safeParse({ from: '2026-11-02', to: '2026-11-01' }).success).toBe(false);
    expect(listTasksQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-01' }).success).toBe(true);
  });
  it('coerces withoutDate', () => {
    expect(listTasksQuerySchema.parse({ withoutDate: 'true' }).withoutDate).toBe(true);
    expect(listTasksQuerySchema.parse({ withoutDate: 'false' }).withoutDate).toBe(false);
    expect(listTasksQuerySchema.safeParse({ withoutDate: 'maybe' }).success).toBe(false);
  });
});
