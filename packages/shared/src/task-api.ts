import { z } from 'zod';
import { calculateDeadlineInputSchema } from './deadline.js';
import { isoDateSchema, type CountType, type IsoDate } from './primitives.js';
import { taskStatusSchema, taskTypeSchema, type TaskStatus, type TaskType } from './task.js';
import { timeOfDaySchema } from './time-of-day.js';

export const deadlineRuleSchema = calculateDeadlineInputSchema;
export type DeadlineRule = z.infer<typeof deadlineRuleSchema>;

const titleSchema = z.string().trim().min(1).max(200);

export const createTaskInputSchema = z
  .object({
    title: titleSchema,
    type: taskTypeSchema.optional(),
    caseId: z.uuid().nullable().default(null),
    dueDate: isoDateSchema.nullable().optional(),
    dueTime: timeOfDaySchema.nullable().optional(),
    fatal: z.boolean().default(false),
    deadline: deadlineRuleSchema.optional(),
  })
  .refine((v) => !(v.deadline !== undefined && v.dueDate != null), {
    message: 'deadline and dueDate cannot be sent together',
    path: ['deadline'],
  })
  .refine((v) => v.dueTime == null || v.dueDate != null || v.deadline !== undefined, {
    message: 'dueTime requires dueDate or deadline',
    path: ['dueTime'],
  });
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

export const updateTaskInputSchema = z
  .object({
    title: titleSchema.optional(),
    type: taskTypeSchema.optional(),
    caseId: z.uuid().nullable().optional(),
    dueDate: isoDateSchema.nullable().optional(),
    dueTime: timeOfDaySchema.nullable().optional(),
    fatal: z.boolean().optional(),
    deadline: deadlineRuleSchema.optional(),
    status: taskStatusSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one field is required',
  })
  .refine((v) => !(v.deadline !== undefined && v.dueDate != null), {
    message: 'deadline and dueDate cannot be sent together',
    path: ['deadline'],
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
    caseId: z.uuid().optional(),
    withoutDate: queryBooleanSchema.optional(),
  })
  .refine((v) => v.from === undefined || v.to === undefined || v.from <= v.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export type TaskDto = {
  id: string;
  caseId: string | null;
  title: string;
  type: TaskType;
  status: TaskStatus;
  dueDate: IsoDate | null;
  dueTime: string | null;
  fatal: boolean;
  baseDate: IsoDate | null;
  periodDays: number | null;
  countType: CountType | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
