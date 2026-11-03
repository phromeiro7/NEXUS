import type { TaskDto } from '@aj/shared';
import { sanitizeTitle } from '../../domain/reminder-message.js';

/** Limite do Telegram por mensagem de texto (em pontos de código, como o cliente HTTP conta). */
export const TELEGRAM_MAX_CHARS = 4096;

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

function weekdayOf(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
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
function cut(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}

/**
 * Texto simples da resposta: a resposta do assistente e, quando houve tarefas afetadas, uma linha
 * por tarefa depois de uma linha em branco. Cabe sempre em 4096 caracteres: o que se corta é a
 * resposta (as linhas das tarefas são o recibo e ficam).
 */
export function formatAssistantReply(reply: string, affected: TaskDto[]): string {
  if (affected.length === 0) return cut(reply, TELEGRAM_MAX_CHARS);
  const block = affected.map(formatTaskLine).join('\n');
  const room = TELEGRAM_MAX_CHARS - Array.from(block).length - 2;
  if (room < 1) return cut(`${reply}\n\n${block}`, TELEGRAM_MAX_CHARS);
  return `${cut(reply, room)}\n\n${block}`;
}
