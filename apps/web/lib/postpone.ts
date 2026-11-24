import type { IsoDate, TaskDto, UpdateTaskInput } from "@nexus/shared";
import { addDays, DAYS_PER_WEEK, daysBetween, formatShort, weekRange } from "./dates";
import { spokenTime } from "./mini-tasks";

/** Atalhos de adiar: para amanhã, para a próxima segunda ou uma semana depois. */
export type PostponeKind = "amanha" | "segunda" | "semana";

const HOURS_PER_DAY = 24;

/** Só tarefa aberta se adia; concluída e cancelada não mostram o atalho. */
export function canPostpone(task: TaskDto): boolean {
  return task.status === "pendente" || task.status === "em_andamento";
}

/** Adiar parte da data da tarefa se ela ainda está no futuro; atrasada, sem data ou de hoje, parte de hoje. */
export function postponeBase(dueDate: IsoDate | null, today: IsoDate): IsoDate {
  return dueDate !== null && dueDate > today ? dueDate : today;
}

/** Primeira segunda-feira depois de `date` (nunca a própria data). */
export function nextMonday(date: IsoDate): IsoDate {
  return addDays(weekRange(date).from, DAYS_PER_WEEK);
}

/** Nova data para o atalho escolhido, contada a partir de `postponeBase`. */
export function postponeDate(kind: PostponeKind, dueDate: IsoDate | null, today: IsoDate): IsoDate {
  const base = postponeBase(dueDate, today);
  if (kind === "amanha") return addDays(base, 1);
  if (kind === "semana") return addDays(base, DAYS_PER_WEEK);
  return nextMonday(base);
}

/** O que enviar à API: a nova data; o horário não é enviado, então a API o mantém. */
export function postponeInput(task: TaskDto, kind: PostponeKind, today: IsoDate): { dueDate: IsoDate } {
  return { dueDate: postponeDate(kind, task.dueDate, today) };
}

/** Restaura data e hora de antes do adiamento (inclusive "sem data" e "sem horário"). */
export function restoreInput(task: TaskDto): UpdateTaskInput {
  return { dueDate: task.dueDate, dueTime: task.dueTime };
}

/** Formatador reaproveitado; em UTC porque as datas abaixo são meia-noite UTC. */
const WEEKDAY_FORMAT = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long" });

function toUtcDate(date: IsoDate): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day));
}

/** "hoje", "amanhã" ou "segunda-feira, 09/11": sempre com a data quando não é hoje nem amanhã. */
export function dateWords(date: IsoDate, today: IsoDate): string {
  const daysFromToday = daysBetween(today, date);
  if (daysFromToday === 0) return "hoje";
  if (daysFromToday === 1) return "amanhã";
  return `${WEEKDAY_FORMAT.format(toUtcDate(date))}, ${formatShort(date)}`;
}

/** Um botão de adiar: a data que ele aplica e os textos visível e para leitores de tela. */
export type PostponeShortcut = { kind: PostponeKind; date: IsoDate; label: string; ariaLabel: string };

/**
 * Atalhos de adiar de uma tarefa aberta: "Amanhã" e "Próxima segunda" (e "Em 1 semana" quando `withWeek`).
 * Datas repetidas somem (domingo: a segunda é amanhã). Concluída/cancelada: lista vazia.
 */
export function postponeShortcuts(task: TaskDto, today: IsoDate, withWeek = false): PostponeShortcut[] {
  if (!canPostpone(task)) return [];
  const kinds: PostponeKind[] = withWeek ? ["amanha", "segunda", "semana"] : ["amanha", "segunda"];
  const shortcuts: PostponeShortcut[] = [];
  for (const kind of kinds) {
    const date = postponeDate(kind, task.dueDate, today);
    if (shortcuts.some((shortcut) => shortcut.date === date)) continue;
    const words = dateWords(date, today);
    shortcuts.push({ kind, date, label: shortcutLabel(kind, date, today), ariaLabel: `Adiar para ${words}: ${task.title}` });
  }
  return shortcuts;
}

/** "Amanhã" só quando a data é mesmo amanhã: adiar uma tarefa futura cai no dia seguinte a ela. */
function shortcutLabel(kind: PostponeKind, date: IsoDate, today: IsoDate): string {
  if (kind === "segunda") return "Próxima segunda";
  if (kind === "semana") return "Daqui a 1 semana";
  return daysBetween(today, date) === 1 ? "Amanhã" : `Dia ${formatShort(date)}`;
}

/** Aviso depois de adiar: ação e data explícitas, sem bronca. Prazo fatal diz que é o prazo que mudou. */
export function postponeMessage(task: TaskDto, input: { dueDate?: IsoDate | null; dueTime?: string | null }, today: IsoDate): string {
  const date = input.dueDate ?? task.dueDate;
  const time = input.dueTime !== undefined ? input.dueTime : task.dueTime;
  const when = date === null ? "sem data" : `${dateWords(date, today)}${time ? `, ${spokenTime(time)}` : ""}`;
  return task.fatal ? `Prazo fatal movido para ${when}: ${task.title}.` : `Adiada para ${when}: ${task.title}.`;
}

/** Uma opção do menu de adiar: chave estável, texto e o que enviar à API. */
export type PostponeOption = { key: string; label: string; input: UpdateTaskInput & { dueDate: IsoDate } };

/** Uma hora depois; passar da meia-noite leva a tarefa para o dia seguinte. */
function plusOneHour(date: IsoDate, time: string): { dueDate: IsoDate; dueTime: string } {
  const [hour = 0, minutes = 0] = time.split(":").map(Number);
  const nextHour = hour + 1;
  const dueTime = `${String(nextHour % HOURS_PER_DAY).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return { dueDate: nextHour >= HOURS_PER_DAY ? addDays(date, 1) : date, dueTime };
}

/** Opções de adiar que fazem sentido para a tarefa; sempre com data e hora explícitas. */
export function postponeOptions(task: TaskDto, today: IsoDate): PostponeOption[] {
  const options: PostponeOption[] = [];
  // "Daqui a 1 hora" só para tarefa de hoje com horário.
  if (task.dueDate !== null && task.dueTime !== null && task.dueDate === today) {
    options.push({ key: "hora", label: "Daqui a 1 hora", input: plusOneHour(task.dueDate, task.dueTime) });
  }
  const isUndatedOrOverdue = task.dueDate === null || task.dueDate < today;
  if (isUndatedOrOverdue) {
    options.push({ key: "hoje", label: "Mover para hoje", input: { dueDate: today } });
  }
  for (const shortcut of postponeShortcuts(task, today, true)) {
    const keepTime = task.dueTime !== null ? { dueTime: task.dueTime } : {};
    options.push({ key: shortcut.kind, label: shortcut.label, input: { dueDate: shortcut.date, ...keepTime } });
  }
  return options;
}
