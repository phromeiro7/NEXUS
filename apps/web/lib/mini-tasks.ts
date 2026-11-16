import type { IsoDate, TaskDto, UpdateTaskInput } from "@nexus/shared";
import { addDays, daysBetween, formatShort } from "./dates";

/** "14:00" → "14h", "14:30" → "14h30" (voz do produto: horário explícito e curto). */
export function spokenTime(time: string): string {
  const [h = "", m = "00"] = time.split(":");
  const hour = String(Number(h));
  return m === "00" ? `${hour}h` : `${hour}h${m}`;
}

function dayWord(date: IsoDate, today: IsoDate): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  if (diff === -1) return "ontem";
  return formatShort(date);
}

/** Quando a tarefa acontece, em uma frase curta e sem tom de bronca. */
export function whenLabel(task: TaskDto, today: IsoDate): string {
  if (task.dueDate === null) return "Sem data";
  const isOpen = task.status === "pendente" || task.status === "em_andamento";
  const diff = daysBetween(today, task.dueDate);
  if (isOpen && diff < 0) {
    return diff === -1 ? "Atrasada desde ontem" : `Atrasada desde ${formatShort(task.dueDate)}`;
  }
  const day = dayWord(task.dueDate, today);
  const cap = day.charAt(0).toUpperCase() + day.slice(1);
  return task.dueTime === null ? `${cap}, sem horário` : `${cap}, ${spokenTime(task.dueTime)}`;
}

/** Estado do lembrete que o app consegue afirmar. "Enviado" não existe aqui: a API não o informa. */
export function reminderState(task: TaskDto): string {
  if (task.status === "concluida") return "Concluída";
  if (task.status === "cancelada") return "Cancelada";
  if (task.dueDate === null) return "Sem lembrete: defina data e horário";
  if (task.dueTime === null) return "Sem lembrete: defina um horário";
  return `Agendado para ${spokenTime(task.dueTime)}`;
}

export type PostponeOption = { key: string; label: string; input: UpdateTaskInput };

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
  out.push({
    key: "amanha",
    label: "Amanhã",
    input: { dueDate: addDays(today, 1), ...(task.dueTime !== null ? { dueTime: task.dueTime } : {}) },
  });
  out.push({
    key: "semana",
    label: "Daqui a 1 semana",
    input: { dueDate: addDays(today, 7), ...(task.dueTime !== null ? { dueTime: task.dueTime } : {}) },
  });
  return out;
}

export function pluralTasks(n: number): string {
  return n === 0 ? "Nenhuma tarefa" : n === 1 ? "1 tarefa" : `${n} tarefas`;
}

/** Dentro da seção "Hoje" o dia é redundante: só o horário (ou a falta dele). */
export function timeOnlyLabel(task: TaskDto): string {
  return task.dueTime === null ? "Sem horário" : spokenTime(task.dueTime);
}

/** Hora local de "agora" (HH:mm) no fuso das configurações; null se o fuso for inválido. */
export function clockIn(timeZone: string, now: Date): string | null {
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  } catch {
    return null;
  }
}

/** Próxima tarefa de hoje com horário ainda por vir (ou em andamento agora), pela hora local. */
export function nextUp(todayTasks: TaskDto[], nowClock: string | null): TaskDto | null {
  if (nowClock === null) return null;
  const timed = todayTasks.filter((t) => t.dueTime !== null).sort((a, b) => (a.dueTime! < b.dueTime! ? -1 : 1));
  return timed.find((t) => t.dueTime! >= nowClock) ?? null;
}

/** "Concluída às 14h12" / "Cancelada às 9h"; null quando a API não trouxe o instante. */
export function closedLabel(task: TaskDto, timeZone: string): string | null {
  const at = task.completedAt;
  if (!at) return null;
  const clock = clockIn(timeZone, new Date(at));
  if (clock === null) return null;
  return `${task.status === "cancelada" ? "Cancelada" : "Concluída"} às ${spokenTime(clock)}`;
}

export function dayTitle(day: IsoDate, today: IsoDate): string {
  const diff = daysBetween(today, day);
  if (diff === 0) return "Hoje";
  if (diff === -1) return "Ontem";
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const s = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Frase do que a captura vai criar, com o dia por extenso ("Hoje, 14h" / "Sem data"). */
export function captureSummary(date: IsoDate | null, time: string, today: IsoDate): { when: string; scheduled: boolean } {
  if (date === null) return { when: "Sem data", scheduled: false };
  const day = dayWord(date, today);
  const cap = day.charAt(0).toUpperCase() + day.slice(1);
  return { when: time === "" ? `${cap}, sem horário` : `${cap}, ${spokenTime(time)}`, scheduled: true };
}
