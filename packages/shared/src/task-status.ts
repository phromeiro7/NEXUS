import type { TaskStatus } from './task.js';

export const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pendente: ['em_andamento', 'concluida', 'cancelada'],
  em_andamento: ['pendente', 'concluida', 'cancelada'],
  concluida: ['pendente'],
  cancelada: ['pendente'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: TaskStatus): readonly TaskStatus[] {
  return ALLOWED_TRANSITIONS[from];
}
