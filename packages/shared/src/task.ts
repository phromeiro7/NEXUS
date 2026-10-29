import { z } from 'zod';
import type { IsoDate } from './primitives.js';

export const taskStatusSchema = z.enum(['pendente', 'em_andamento', 'concluida', 'cancelada']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskTypeSchema = z.enum(['prazo', 'tarefa', 'audiencia']);
export type TaskType = z.infer<typeof taskTypeSchema>;

export type TaskClassification = 'atrasada' | 'hoje' | 'futura' | 'sem_data' | 'encerrada';

export function classifyTask(
  task: { status: TaskStatus; dueDate: IsoDate | null },
  today: IsoDate,
): TaskClassification {
  if (task.status === 'concluida' || task.status === 'cancelada') return 'encerrada';
  if (task.dueDate === null) return 'sem_data';
  // ISO dates compare correctly as strings.
  if (task.dueDate < today) return 'atrasada';
  if (task.dueDate === today) return 'hoje';
  return 'futura';
}
