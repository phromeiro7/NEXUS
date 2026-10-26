import { describe, expect, it } from 'vitest';
import { classifyTask } from './task.js';

describe('classifyTask', () => {
  const today = '2026-10-26';
  it('classifies by due date', () => {
    expect(classifyTask({ status: 'pendente', dueDate: '2026-10-25' }, today)).toBe('atrasada');
    expect(classifyTask({ status: 'pendente', dueDate: '2026-10-26' }, today)).toBe('hoje');
    expect(classifyTask({ status: 'pendente', dueDate: '2026-10-27' }, today)).toBe('futura');
    expect(classifyTask({ status: 'pendente', dueDate: null }, today)).toBe('sem_data');
  });
  it('closed statuses are encerrada', () => {
    expect(classifyTask({ status: 'concluida', dueDate: '2026-10-25' }, today)).toBe('encerrada');
    expect(classifyTask({ status: 'cancelada', dueDate: null }, today)).toBe('encerrada');
  });
});
