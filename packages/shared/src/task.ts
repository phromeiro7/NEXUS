import { z } from 'zod';
import type { IsoDate } from './primitives.js';

export const taskStatusSchema = z.enum(['pendente', 'em_andamento', 'concluida', 'cancelada']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskTypeSchema = z.enum(['prazo', 'tarefa', 'audiencia']);
export type TaskType = z.infer<typeof taskTypeSchema>;

/** Situação da tarefa em relação a hoje, usada para agrupar nas telas. */
export type TaskClassification = 'atrasada' | 'hoje' | 'futura' | 'sem_data' | 'encerrada';

/** Classifica a tarefa: encerrada primeiro, depois sem data, e então pela data em relação a `today`. */
export function classifyTask(
  task: { status: TaskStatus; dueDate: IsoDate | null },
  today: IsoDate,
): TaskClassification {
  if (task.status === 'concluida' || task.status === 'cancelada') return 'encerrada';
  if (task.dueDate === null) return 'sem_data';
  // Datas ISO comparam corretamente como texto.
  if (task.dueDate < today) return 'atrasada';
  if (task.dueDate === today) return 'hoje';
  return 'futura';
}
