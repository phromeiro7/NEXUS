import type { TaskStatus } from '@aj/shared';
import { describe, expect, it } from 'vitest';
import { applyStatusChange, canTransition, InvalidTransitionError } from './task-status.js';

const now = new Date('2026-10-26T12:00:00Z');

describe('canTransition', () => {
  const allowed: Array<[TaskStatus, TaskStatus]> = [
    ['pendente', 'em_andamento'],
    ['pendente', 'concluida'],
    ['pendente', 'cancelada'],
    ['em_andamento', 'pendente'],
    ['em_andamento', 'concluida'],
    ['em_andamento', 'cancelada'],
    ['concluida', 'pendente'],
    ['cancelada', 'pendente'],
  ];
  it.each(allowed)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  const denied: Array<[TaskStatus, TaskStatus]> = [
    ['concluida', 'em_andamento'],
    ['concluida', 'cancelada'],
    ['cancelada', 'em_andamento'],
    ['cancelada', 'concluida'],
    ['pendente', 'pendente'],
    ['concluida', 'concluida'],
  ];
  it.each(denied)('denies %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe('applyStatusChange', () => {
  it('sets completedAt to now when entering concluida', () => {
    const r = applyStatusChange({ status: 'pendente', completedAt: null }, 'concluida', now);
    expect(r).toEqual({ status: 'concluida', completedAt: now });
  });

  it('clears completedAt when leaving concluida', () => {
    const r = applyStatusChange({ status: 'concluida', completedAt: now }, 'pendente', now);
    expect(r).toEqual({ status: 'pendente', completedAt: null });
  });

  it('keeps completedAt null for other allowed transitions', () => {
    const r = applyStatusChange({ status: 'pendente', completedAt: null }, 'em_andamento', now);
    expect(r).toEqual({ status: 'em_andamento', completedAt: null });
  });

  it('throws InvalidTransitionError for a disallowed transition', () => {
    expect(() =>
      applyStatusChange({ status: 'concluida', completedAt: now }, 'em_andamento', now),
    ).toThrow(InvalidTransitionError);
  });

  it('throws on same-status change', () => {
    expect(() =>
      applyStatusChange({ status: 'pendente', completedAt: null }, 'pendente', now),
    ).toThrow(InvalidTransitionError);
  });

  it('does not mutate its input', () => {
    const task = { status: 'pendente' as TaskStatus, completedAt: null as Date | null };
    applyStatusChange(task, 'concluida', now);
    expect(task).toEqual({ status: 'pendente', completedAt: null });
  });
});
