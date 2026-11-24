import type { TaskDto } from '@nexus/shared';
import { sanitizeTitle } from '../../domain/reminder-message.js';

/** Limite do Telegram por mensagem de texto (em pontos de código, como o cliente HTTP conta). */
export const TELEGRAM_MAX_CHARS = 4096;

/** Linha em branco entre a resposta e as linhas das tarefas. */
const SEPARATOR = '\n\n';
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

function weekdayOf(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!;
}

/** `• Título — qua, 28/10, 14:00`, `• Título — qua, 28/10, dia inteiro` ou `• Título — sem data`. */
export function formatTaskLine(task: Pick<TaskDto, 'title' | 'dueDate' | 'dueTime'>): string {
  const title = sanitizeTitle(task.title);
  if (task.dueDate === null) return `• ${title} — sem data`;
  const [, month, day] = task.dueDate.split('-');
  const when = `${weekdayOf(task.dueDate)}, ${day}/${month}`;
  return `• ${title} — ${when}, ${task.dueTime ?? 'dia inteiro'}`;
}

/** Corta em pontos de código (nunca no meio de um emoji), terminando com "…" quando cortou. */
function truncate(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return `${chars.slice(0, Math.max(0, maxChars - 1)).join('')}…`;
}

/**
 * Texto simples da resposta: a resposta do assistente e, quando houve tarefas afetadas, uma linha
 * por tarefa depois de uma linha em branco. Cabe sempre em 4096 caracteres: o que se corta é a
 * resposta (as linhas das tarefas são o recibo e ficam).
 */
export function formatAssistantReply(reply: string, affected: TaskDto[]): string {
  if (affected.length === 0) return truncate(reply, TELEGRAM_MAX_CHARS);
  const taskLines = affected.map(formatTaskLine).join('\n');
  const roomForReply = TELEGRAM_MAX_CHARS - Array.from(taskLines).length - SEPARATOR.length;
  if (roomForReply < 1) return truncate(`${reply}${SEPARATOR}${taskLines}`, TELEGRAM_MAX_CHARS);
  return `${truncate(reply, roomForReply)}${SEPARATOR}${taskLines}`;
}
