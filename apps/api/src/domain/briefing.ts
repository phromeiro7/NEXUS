import type { IsoDate, TaskStatus, TaskType } from '@nexus/shared';
import { addDays } from './calendar.js';

type BriefingTask = {
  status: TaskStatus;
  dueDate: IsoDate | null;
  dueTime: string | null;
  fatal: boolean;
  type: TaskType;
};

/** Ordena por data, depois hora (sem hora por último). `Array.prototype.sort` é estável. */
function byDateThenTime<T extends BriefingTask>(a: T, b: T): number {
  if (a.dueDate !== b.dueDate) return (a.dueDate as string) < (b.dueDate as string) ? -1 : 1;
  if (a.dueTime === b.dueTime) return 0;
  if (a.dueTime === null) return 1;
  if (b.dueTime === null) return -1;
  return a.dueTime < b.dueTime ? -1 : 1;
}

/** Monta as listas do briefing diário a partir das tarefas abertas com data. */
export function buildBriefing<T extends BriefingTask>(
  tasks: T[],
  today: IsoDate,
): { overdue: T[]; fatalToday: T[]; hearingsToday: T[]; nextTwoDays: T[] } {
  const limit = addDays(today, 2);
  const open = tasks
    .filter((t) => (t.status === 'pendente' || t.status === 'em_andamento') && t.dueDate !== null)
    .sort(byDateThenTime);
  return {
    overdue: open.filter((t) => (t.dueDate as string) < today),
    fatalToday: open.filter((t) => t.dueDate === today && t.fatal),
    hearingsToday: open.filter((t) => t.dueDate === today && t.type === 'audiencia'),
    nextTwoDays: open.filter((t) => (t.dueDate as string) > today && (t.dueDate as string) <= limit),
  };
}
