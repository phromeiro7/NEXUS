import type { IsoDate, TaskDto } from '@nexus/shared';
import { addDays, daysBetween, todayIn } from './dates';

export type DayGroups = {
  overdue: TaskDto[];
  fatalToday: TaskDto[];
  timed: TaskDto[];
  dateOnly: TaskDto[];
  undated: TaskDto[];
};

function isOpen(t: TaskDto): boolean {
  return t.status === 'pendente' || t.status === 'em_andamento';
}

/** Time ascending; tasks without time go last. */
function byTime(a: TaskDto, b: TaskDto): number {
  if (a.dueTime === b.dueTime) return 0;
  if (a.dueTime === null) return 1;
  if (b.dueTime === null) return -1;
  return a.dueTime < b.dueTime ? -1 : 1;
}

function byDateThenTime(a: TaskDto, b: TaskDto): number {
  if (a.dueDate !== b.dueDate) return (a.dueDate ?? '') < (b.dueDate ?? '') ? -1 : 1;
  return byTime(a, b);
}

export function groupDay(tasks: TaskDto[], today: IsoDate): DayGroups {
  const open = tasks.filter(isOpen);
  const dueToday = open.filter((t) => t.dueDate === today);
  return {
    overdue: open.filter((t) => t.dueDate !== null && t.dueDate < today).sort(byDateThenTime),
    fatalToday: dueToday.filter((t) => t.fatal).sort(byTime),
    timed: dueToday.filter((t) => !t.fatal && t.dueTime !== null).sort(byTime),
    dateOnly: dueToday.filter((t) => !t.fatal && t.dueTime === null),
    undated: open.filter((t) => t.dueDate === null),
  };
}

export function groupWeek(
  tasks: TaskDto[],
  from: IsoDate,
): Array<{ date: IsoDate; tasks: TaskDto[] }> {
  const open = tasks.filter(isOpen);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(from, i);
    return { date, tasks: open.filter((t) => t.dueDate === date).sort(byTime) };
  });
}

export function countByDay(tasks: TaskDto[]): Record<IsoDate, { total: number; fatal: number }> {
  const out: Record<string, { total: number; fatal: number }> = {};
  for (const t of tasks) {
    if (!isOpen(t) || t.dueDate === null) continue;
    const entry = (out[t.dueDate] ??= { total: 0, fatal: 0 });
    entry.total += 1;
    if (t.fatal) entry.fatal += 1;
  }
  return out;
}

export function urgencyLabel(task: TaskDto, today: IsoDate): string {
  if (task.status === 'concluida') return 'concluída';
  if (task.status === 'cancelada') return 'cancelada';
  if (task.dueDate === null) return 'sem data';
  const diff = daysBetween(today, task.dueDate);
  if (diff < 0) return `atrasada há ${-diff} ${diff === -1 ? 'dia' : 'dias'}`;
  if (diff === 0) return 'vence hoje';
  if (diff === 1) return 'vence amanhã';
  return `em ${diff} dias`;
}

export function pendingCount(tasks: TaskDto[], today: IsoDate): number {
  return tasks.filter((t) => isOpen(t) && t.dueDate !== null && t.dueDate <= today).length;
}

export function groupHistory(
  tasks: TaskDto[],
  opts: { timeZone: string; includeCancelled?: boolean },
): Array<{ day: IsoDate; tasks: TaskDto[] }> {
  const entries: Array<{ day: IsoDate; at: string; task: TaskDto }> = [];
  for (const t of tasks) {
    if (t.status === 'concluida') {
      const at = t.completedAt ?? t.updatedAt;
      entries.push({ day: todayIn(opts.timeZone, new Date(at)), at, task: t });
    } else if (t.status === 'cancelada' && opts.includeCancelled) {
      const at = t.completedAt ?? t.updatedAt;
      entries.push({ day: todayIn(opts.timeZone, new Date(at)), at, task: t });
    }
  }
  // Most recent first, both across days and within a day.
  entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const groups = new Map<IsoDate, TaskDto[]>();
  for (const e of entries) {
    const list = groups.get(e.day);
    if (list) list.push(e.task);
    else groups.set(e.day, [e.task]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, ts]) => ({ day, tasks: ts }));
}
