import type { IsoDate, TaskStatus, TaskType } from '@nexus/shared';
import { addDays } from './calendar.js';

type BriefingTask = {
  status: TaskStatus;
  dueDate: IsoDate | null;
  dueTime: string | null;
  fatal: boolean;
  type: TaskType;
};

/** Quantos dias depois de hoje entram em "próximos dias" (hoje fica de fora). */
const UPCOMING_DAYS = 2;

/** Ordena por data, depois hora (sem hora por último). `Array.prototype.sort` é estável. */
function compareByDateThenTime<T extends BriefingTask>(a: T, b: T): number {
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
  const upcomingLimit = addDays(today, UPCOMING_DAYS);
  const isOpen = (task: T): boolean => task.status === 'pendente' || task.status === 'em_andamento';
  // Datas ISO comparam corretamente como texto.
  const openDatedTasks = tasks.filter((task) => isOpen(task) && task.dueDate !== null).sort(compareByDateThenTime);
  return {
    overdue: openDatedTasks.filter((task) => (task.dueDate as string) < today),
    fatalToday: openDatedTasks.filter((task) => task.dueDate === today && task.fatal),
    hearingsToday: openDatedTasks.filter((task) => task.dueDate === today && task.type === 'audiencia'),
    nextTwoDays: openDatedTasks.filter(
      (task) => (task.dueDate as string) > today && (task.dueDate as string) <= upcomingLimit,
    ),
  };
}
