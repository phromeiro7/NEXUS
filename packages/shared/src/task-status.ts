import type { TaskStatus } from './task.js';

/** Máquina de estados da tarefa: para quais status cada status pode ir. */
export const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pendente: ['em_andamento', 'concluida', 'cancelada'],
  em_andamento: ['pendente', 'concluida', 'cancelada'],
  concluida: ['pendente'],
  cancelada: ['pendente'],
};

/** Se a tarefa pode passar de `from` para `to`. */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Status para os quais a tarefa pode ir a partir de `from` (ex.: para montar o menu de ações). */
export function nextStatuses(from: TaskStatus): readonly TaskStatus[] {
  return ALLOWED_TRANSITIONS[from];
}
