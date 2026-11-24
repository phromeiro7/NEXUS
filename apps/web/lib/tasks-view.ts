import type { IsoDate, TaskDto } from '@nexus/shared';
import { addDays, daysBetween, todayIn } from './dates';

const DAYS_PER_WEEK = 7;

/** Seções da tela "Hoje", na ordem em que aparecem. */
export type DayGroups = {
  overdue: TaskDto[];
  fatalToday: TaskDto[];
  timed: TaskDto[];
  dateOnly: TaskDto[];
  undated: TaskDto[];
};

function isOpen(task: TaskDto): boolean {
  return task.status === 'pendente' || task.status === 'em_andamento';
}

/** Time ascending; tasks without time go last. */
function byTime(first: TaskDto, second: TaskDto): number {
  if (first.dueTime === second.dueTime) return 0;
  if (first.dueTime === null) return 1;
  if (second.dueTime === null) return -1;
  return first.dueTime < second.dueTime ? -1 : 1;
}

function byDateThenTime(first: TaskDto, second: TaskDto): number {
  if (first.dueDate !== second.dueDate) return (first.dueDate ?? '') < (second.dueDate ?? '') ? -1 : 1;
  return byTime(first, second);
}

/** Separa as tarefas abertas nas seções de "Hoje": atrasadas, prazos fatais de hoje, com hora, só com data e sem data. */
export function groupDay(tasks: TaskDto[], today: IsoDate): DayGroups {
  const openTasks = tasks.filter(isOpen);
  const dueToday = openTasks.filter((task) => task.dueDate === today);
  return {
    overdue: openTasks.filter((task) => task.dueDate !== null && task.dueDate < today).sort(byDateThenTime),
    fatalToday: dueToday.filter((task) => task.fatal).sort(byTime),
    timed: dueToday.filter((task) => !task.fatal && task.dueTime !== null).sort(byTime),
    dateOnly: dueToday.filter((task) => !task.fatal && task.dueTime === null),
    undated: openTasks.filter((task) => task.dueDate === null),
  };
}

/** Os sete dias a partir de `from`, cada um com suas tarefas abertas ordenadas por horário. */
export function groupWeek(
  tasks: TaskDto[],
  from: IsoDate,
): Array<{ date: IsoDate; tasks: TaskDto[] }> {
  const openTasks = tasks.filter(isOpen);
  return Array.from({ length: DAYS_PER_WEEK }, (_, dayOffset) => {
    const date = addDays(from, dayOffset);
    return { date, tasks: openTasks.filter((task) => task.dueDate === date).sort(byTime) };
  });
}

/** Quantas tarefas abertas (e quantas fatais) há em cada dia: alimenta os marcadores do calendário. */
export function countByDay(tasks: TaskDto[]): Record<IsoDate, { total: number; fatal: number }> {
  const countsByDay: Record<string, { total: number; fatal: number }> = {};
  for (const task of tasks) {
    if (!isOpen(task) || task.dueDate === null) continue;
    const dayCount = (countsByDay[task.dueDate] ??= { total: 0, fatal: 0 });
    dayCount.total += 1;
    if (task.fatal) dayCount.fatal += 1;
  }
  return countsByDay;
}

/** Urgência em poucas palavras ("atrasada há 2 dias", "vence hoje", "em 5 dias"). */
export function urgencyLabel(task: TaskDto, today: IsoDate): string {
  if (task.status === 'concluida') return 'concluída';
  if (task.status === 'cancelada') return 'cancelada';
  if (task.dueDate === null) return 'sem data';
  const daysFromToday = daysBetween(today, task.dueDate);
  if (daysFromToday < 0) return `atrasada há ${-daysFromToday} ${daysFromToday === -1 ? 'dia' : 'dias'}`;
  if (daysFromToday === 0) return 'vence hoje';
  if (daysFromToday === 1) return 'vence amanhã';
  return `em ${daysFromToday} dias`;
}

/** Tarefas abertas que vencem hoje ou já venceram. */
export function pendingCount(tasks: TaskDto[], today: IsoDate): number {
  return tasks.filter((task) => isOpen(task) && task.dueDate !== null && task.dueDate <= today).length;
}

/**
 * Histórico de tarefas encerradas agrupado pelo dia (no fuso do usuário) em que foram encerradas.
 * Canceladas só entram com `includeCancelled`.
 */
export function groupHistory(
  tasks: TaskDto[],
  options: { timeZone: string; includeCancelled?: boolean },
): Array<{ day: IsoDate; tasks: TaskDto[] }> {
  const entries: Array<{ day: IsoDate; closedAt: string; task: TaskDto }> = [];
  for (const task of tasks) {
    const isIncluded = task.status === 'concluida' || (task.status === 'cancelada' && options.includeCancelled);
    if (!isIncluded) continue;
    // Sem `completedAt` (dados antigos), a última atualização é a melhor estimativa do encerramento.
    const closedAt = task.completedAt ?? task.updatedAt;
    // O dia do encerramento é o do fuso do usuário, não o do navegador nem o UTC.
    entries.push({ day: todayIn(options.timeZone, new Date(closedAt)), closedAt, task });
  }
  // Most recent first, both across days and within a day.
  entries.sort((first, second) => Date.parse(second.closedAt) - Date.parse(first.closedAt));
  const tasksByDay = new Map<IsoDate, TaskDto[]>();
  for (const entry of entries) {
    const dayTasks = tasksByDay.get(entry.day);
    if (dayTasks) dayTasks.push(entry.task);
    else tasksByDay.set(entry.day, [entry.task]);
  }
  return [...tasksByDay.entries()]
    .sort(([firstDay], [secondDay]) => (firstDay < secondDay ? 1 : firstDay > secondDay ? -1 : 0))
    .map(([day, dayTasks]) => ({ day, tasks: dayTasks }));
}
