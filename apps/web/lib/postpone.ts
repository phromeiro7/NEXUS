import type { IsoDate, TaskDto, UpdateTaskInput } from "@nexus/shared";
import { addDays, daysBetween, formatShort, weekRange } from "./dates";
import { spokenTime } from "./mini-tasks";

export type PostponeKind = "amanha" | "segunda" | "semana";

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
  return addDays(weekRange(date).from, 7);
}

export function postponeDate(kind: PostponeKind, dueDate: IsoDate | null, today: IsoDate): IsoDate {
  const base = postponeBase(dueDate, today);
  if (kind === "amanha") return addDays(base, 1);
  if (kind === "semana") return addDays(base, 7);
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

const WEEKDAY = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long" });

function utc(date: IsoDate): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/** "hoje", "amanhã" ou "segunda-feira, 09/11": sempre com a data quando não é hoje nem amanhã. */
export function dateWords(date: IsoDate, today: IsoDate): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  return `${WEEKDAY.format(utc(date))}, ${formatShort(date)}`;
}

export type PostponeShortcut = { kind: PostponeKind; date: IsoDate; label: string; ariaLabel: string };

/**
 * Atalhos de adiar de uma tarefa aberta: "Amanhã" e "Próxima segunda" (e "Em 1 semana" quando `withWeek`).
 * Datas repetidas somem (domingo: a segunda é amanhã). Concluída/cancelada: lista vazia.
 */
export function postponeShortcuts(task: TaskDto, today: IsoDate, withWeek = false): PostponeShortcut[] {
  if (!canPostpone(task)) return [];
  const kinds: PostponeKind[] = withWeek ? ["amanha", "segunda", "semana"] : ["amanha", "segunda"];
  const out: PostponeShortcut[] = [];
  for (const kind of kinds) {
    const date = postponeDate(kind, task.dueDate, today);
    if (out.some((s) => s.date === date)) continue;
    const words = dateWords(date, today);
    const label =
      kind === "segunda"
        ? "Próxima segunda"
        : kind === "semana"
          ? "Daqui a 1 semana"
          : daysBetween(today, date) === 1
            ? "Amanhã"
            : `Dia ${formatShort(date)}`;
    out.push({ kind, date, label, ariaLabel: `Adiar para ${words}: ${task.title}` });
  }
  return out;
}

/** Aviso depois de adiar: ação e data explícitas, sem bronca. Prazo fatal diz que é o prazo que mudou. */
export function postponeMessage(task: TaskDto, input: { dueDate?: IsoDate | null; dueTime?: string | null }, today: IsoDate): string {
  const date = input.dueDate ?? task.dueDate;
  const time = input.dueTime !== undefined ? input.dueTime : task.dueTime;
  const when = date === null ? "sem data" : `${dateWords(date, today)}${time ? `, ${spokenTime(time)}` : ""}`;
  return task.fatal ? `Prazo fatal movido para ${when}: ${task.title}.` : `Adiada para ${when}: ${task.title}.`;
}

export type PostponeOption = { key: string; label: string; input: UpdateTaskInput & { dueDate: IsoDate } };

function plusOneHour(date: IsoDate, time: string): { dueDate: IsoDate; dueTime: string } {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const next = h + 1;
  const dueTime = `${String(next % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return { dueDate: next >= 24 ? addDays(date, 1) : date, dueTime };
}

/** Opções de adiar que fazem sentido para a tarefa; sempre com data e hora explícitas. */
export function postponeOptions(task: TaskDto, today: IsoDate): PostponeOption[] {
  const out: PostponeOption[] = [];
  if (task.dueDate !== null && task.dueTime !== null && task.dueDate === today) {
    out.push({ key: "hora", label: "Daqui a 1 hora", input: plusOneHour(task.dueDate, task.dueTime) });
  }
  if (task.dueDate === null || task.dueDate < today) {
    out.push({ key: "hoje", label: "Mover para hoje", input: { dueDate: today } });
  }
  for (const s of postponeShortcuts(task, today, true)) {
    out.push({ key: s.kind, label: s.label, input: { dueDate: s.date, ...(task.dueTime !== null ? { dueTime: task.dueTime } : {}) } });
  }
  return out;
}
