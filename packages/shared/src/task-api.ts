import { z } from 'zod';
import { isoDateSchema, type IsoDate } from './primitives.js';
import { taskStatusSchema, taskTypeSchema, type TaskStatus, type TaskType } from './task.js';
import { timeOfDaySchema } from './time-of-day.js';

/** Tamanho máximo do título de tarefa; a API valida e as telas limitam o campo com o mesmo valor. */
export const TASK_TITLE_MAX = 200;

const titleSchema = z.string().trim().min(1).max(TASK_TITLE_MAX);

/** Corpo de `POST /tasks`. Hora sem data não faz sentido e é recusada. */
export const createTaskInputSchema = z
  .object({
    title: titleSchema,
    type: taskTypeSchema.optional(),
    dueDate: isoDateSchema.nullable().optional(),
    dueTime: timeOfDaySchema.nullable().optional(),
    fatal: z.boolean().default(false),
  })
  .refine((input) => input.dueTime == null || input.dueDate != null, {
    message: 'dueTime requires dueDate',
    path: ['dueTime'],
  });
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

/** Corpo de `PATCH /tasks/:id`: só os campos enviados mudam; pelo menos um é obrigatório. */
export const updateTaskInputSchema = z
  .object({
    title: titleSchema.optional(),
    type: taskTypeSchema.optional(),
    dueDate: isoDateSchema.nullable().optional(),
    dueTime: timeOfDaySchema.nullable().optional(),
    fatal: z.boolean().optional(),
    status: taskStatusSchema.optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'At least one field is required',
  });
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;

/** Query-string `status`: texto separado por vírgulas ou parâmetro repetido. */
const statusListSchema = z.preprocess(
  (rawValue) => {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    // Algo que não é texto segue intacto para o `z.array` recusar com a mensagem certa.
    if (!values.every((value) => typeof value === 'string')) return rawValue;
    return values.flatMap((value: string) => value.split(',')).filter((status) => status !== '');
  },
  z.array(taskStatusSchema),
);

/** Booleano de query-string: só os textos 'true' / 'false'. */
const queryBooleanSchema = z.preprocess(
  (rawValue) => (rawValue === 'true' ? true : rawValue === 'false' ? false : rawValue),
  z.boolean(),
);

/** Query-string de `GET /tasks`. */
export const listTasksQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    status: statusListSchema.optional(),
    withoutDate: queryBooleanSchema.optional(),
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

/** Tarefa como a API devolve. */
export type TaskDto = {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  dueDate: IsoDate | null;
  dueTime: string | null;
  fatal: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
