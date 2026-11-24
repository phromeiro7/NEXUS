import { canTransition, type TaskStatus } from '@nexus/shared';

/** Lançado quando a mudança de status não é permitida por `canTransition`. */
export class InvalidTransitionError extends Error {
  constructor(
    readonly from: TaskStatus,
    readonly to: TaskStatus,
  ) {
    super(`Invalid status transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export { canTransition };

/** Retorna o novo estado sem mutar a entrada. `completedAt` acompanha a entrada/saída de `concluida`. */
export function applyStatusChange(
  task: { status: TaskStatus; completedAt: Date | null },
  to: TaskStatus,
  now: Date,
): { status: TaskStatus; completedAt: Date | null } {
  if (!canTransition(task.status, to)) throw new InvalidTransitionError(task.status, to);
  return { status: to, completedAt: to === 'concluida' ? now : null };
}
