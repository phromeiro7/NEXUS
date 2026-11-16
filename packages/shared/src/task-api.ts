import { z } from 'zod';
import { isoDateSchema, type IsoDate } from './primitives.js';
import { taskStatusSchema, taskTypeSchema, type TaskStatus, type TaskType } from './task.js';
import { timeOfDaySchema } from './time-of-day.js';

const titleSchema = z.string().trim().min(1).max(200);

export const createTaskInputSchema = z
  .object({
    title: titleSchema,
    type: taskTypeSchema.optional(),
    dueDate: isoDateSchema.nullable().optional(),
    dueTime: timeOfDaySchema.nullable().optional(),
    fatal: z.boolean().default(false),
  })
  .refine((v) => v.dueTime == null || v.dueDate != null, {
    message: 'dueTime requires dueDate',
    path: ['dueTime'],
  });
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

export const updateTaskInputSchema = z
  .object({
    title: titleSchema.optional(),
    type: taskTypeSchema.optional(),
    dueDate: isoDateSchema.nullable().optional(),
    dueTime: timeOfDaySchema.nullable().optional(),
    fatal: z.boolean().optional(),
    status: taskStatusSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one field is required',
  });
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;

/** Query-string `status`: comma-separated string or repeated parameter. */
const statusListSchema = z.preprocess(
  (v) => {
    const parts = Array.isArray(v) ? v : [v];
    if (!parts.every((p) => typeof p === 'string')) return v;
    return parts.flatMap((p: string) => p.split(',')).filter((p) => p !== '');
  },
  z.array(taskStatusSchema),
);

/** Query-string boolean: only the strings 'true' / 'false'. */
const queryBooleanSchema = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean(),
);

export const listTasksQuerySchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    status: statusListSchema.optional(),
    withoutDate: queryBooleanSchema.optional(),
  })
  .refine((v) => v.from === undefined || v.to === undefined || v.from <= v.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

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
