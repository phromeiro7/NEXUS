import { describe, expect, it } from 'vitest';
import { canTransition, nextStatuses } from './task-status.js';

describe('canTransition', () => {
  it('forbids concluida -> em_andamento but allows concluida -> pendente', () => {
    expect(canTransition('concluida', 'em_andamento')).toBe(false);
    expect(canTransition('concluida', 'pendente')).toBe(true);
  });

  it('allows open states to move to any other state', () => {
    expect(canTransition('pendente', 'em_andamento')).toBe(true);
    expect(canTransition('em_andamento', 'cancelada')).toBe(true);
  });

  it('forbids staying in the same state', () => {
    expect(canTransition('pendente', 'pendente')).toBe(false);
  });
});

describe('nextStatuses', () => {
  it('lists the allowed targets', () => {
    expect(nextStatuses('cancelada')).toEqual(['pendente']);
    expect(nextStatuses('pendente')).toEqual(['em_andamento', 'concluida', 'cancelada']);
  });
});
