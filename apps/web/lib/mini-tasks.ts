import type { IsoDate, TaskDto } from "@nexus/shared";
import { daysBetween, formatShort } from "./dates";

/** Primeira letra maiúscula, para palavras que abrem a frase ("hoje" → "Hoje"). */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "14:00" → "14h", "14:30" → "14h30" (voz do produto: horário explícito e curto). */
export function spokenTime(time: string): string {
  const [hourText = "", minutes = "00"] = time.split(":");
  const hour = String(Number(hourText)); // tira o zero à esquerda: "09" → "9"
  return minutes === "00" ? `${hour}h` : `${hour}h${minutes}`;
}

/** "hoje", "amanhã", "ontem" ou "dd/mm". */
function dayWord(date: IsoDate, today: IsoDate): string {
  const daysFromToday = daysBetween(today, date);
  if (daysFromToday === 0) return "hoje";
  if (daysFromToday === 1) return "amanhã";
  if (daysFromToday === -1) return "ontem";
  return formatShort(date);
}

/** Quando a tarefa acontece, em uma frase curta e sem tom de bronca. */
export function whenLabel(task: TaskDto, today: IsoDate): string {
  if (task.dueDate === null) return "Sem data";
  const isOpen = task.status === "pendente" || task.status === "em_andamento";
  const daysFromToday = daysBetween(today, task.dueDate);
  if (isOpen && daysFromToday < 0) {
    return daysFromToday === -1 ? "Atrasada desde ontem" : `Atrasada desde ${formatShort(task.dueDate)}`;
  }
  const day = capitalize(dayWord(task.dueDate, today));
  return task.dueTime === null ? `${day}, sem horário` : `${day}, ${spokenTime(task.dueTime)}`;
}

/** Estado do lembrete que o app consegue afirmar. "Enviado" não existe aqui: a API não o informa. */
export function reminderState(task: TaskDto): string {
  if (task.status === "concluida") return "Concluída";
  if (task.status === "cancelada") return "Cancelada";
  if (task.dueDate === null) return "Sem lembrete: defina data e horário";
  if (task.dueTime === null) return "Sem lembrete: defina um horário";
  return `Agendado para ${spokenTime(task.dueTime)}`;
}

/** Contagem de tarefas com o plural certo ("Nenhuma tarefa", "1 tarefa", "3 tarefas"). */
export function pluralTasks(count: number): string {
  if (count === 0) return "Nenhuma tarefa";
  if (count === 1) return "1 tarefa";
  return `${count} tarefas`;
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
  // "HH:mm" com zero à esquerda: comparar como texto é o mesmo que comparar horários.
  const timed = todayTasks
    .filter((task) => task.dueTime !== null)
    .sort((first, second) => (first.dueTime! < second.dueTime! ? -1 : 1));
  return timed.find((task) => task.dueTime! >= nowClock) ?? null;
}

/** "Concluída às 14h12" / "Cancelada às 9h"; null quando a API não trouxe o instante. */
export function closedLabel(task: TaskDto, timeZone: string): string | null {
  const closedAt = task.completedAt;
  if (!closedAt) return null;
  const clock = clockIn(timeZone, new Date(closedAt));
  if (clock === null) return null;
  return `${task.status === "cancelada" ? "Cancelada" : "Concluída"} às ${spokenTime(clock)}`;
}

/** Título de um dia no histórico: "Hoje", "Ontem" ou "Segunda-feira, 9 de novembro". */
export function dayTitle(day: IsoDate, today: IsoDate): string {
  const daysFromToday = daysBetween(today, day);
  if (daysFromToday === 0) return "Hoje";
  if (daysFromToday === -1) return "Ontem";
  const [year, month, dayOfMonth] = day.split("-").map(Number) as [number, number, number];
  // Meia-noite UTC formatada em UTC: o dia não muda com o fuso do navegador.
  const longDate = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(Date.UTC(year, month - 1, dayOfMonth)),
  );
  return capitalize(longDate);
}

/** Frase do que a captura vai criar, com o dia por extenso ("Hoje, 14h" / "Sem data"). */
export function captureSummary(date: IsoDate | null, time: string, today: IsoDate): { when: string; scheduled: boolean } {
  if (date === null) return { when: "Sem data", scheduled: false };
  const day = capitalize(dayWord(date, today));
  return { when: time === "" ? `${day}, sem horário` : `${day}, ${spokenTime(time)}`, scheduled: true };
}
