import type { TaskStatus } from '@aj/shared';

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: TaskStatus,
    readonly to: TaskStatus,
  ) {
    super(`Invalid status transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

const ALLOWED: Record<TaskStatus, readonly TaskStatus[]> = {
  pendente: ['em_andamento', 'concluida', 'cancelada'],
  em_andamento: ['pendente', 'concluida', 'cancelada'],
  concluida: ['pendente'],
  cancelada: ['pendente'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** Retorna o novo estado sem mutar a entrada. `completedAt` acompanha a entrada/saída de `concluida`. */
export function applyStatusChange(
  task: { status: TaskStatus; completedAt: Date | null },
  to: TaskStatus,
  now: Date,
): { status: TaskStatus; completedAt: Date | null } {
  if (!canTransition(task.status, to)) throw new InvalidTransitionError(task.status, to);
  return { status: to, completedAt: to === 'concluida' ? now : null };
}
