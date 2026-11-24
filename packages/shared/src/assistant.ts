import { z } from 'zod';
import type { BriefingDto } from './briefing.js';
import type { IsoDate } from './primitives.js';
import type { TaskDto } from './task-api.js';
import { TASK_TYPE_LABEL } from './task.js';

const ASSISTANT_MESSAGE_MAX = 1000;

/** Mensagem da pessoa para o assistente; `clientMessageId` torna o reenvio idempotente. */
export const assistantMessageInputSchema = z.object({
  text: z.string().trim().min(1).max(ASSISTANT_MESSAGE_MAX),
  clientMessageId: z.uuid(),
});
export type AssistantMessageInput = z.infer<typeof assistantMessageInputSchema>;

/** `affectedTasks`: tarefas criadas/alteradas/concluídas neste ciclo, sem ids repetidos. */
export type AssistantReplyDto = { reply: string; affectedTasks: TaskDto[] };

/** Ex.: "segunda-feira, 3 de março de 2025". Em UTC porque a data ISO já é o dia local. */
const LONG_DATE_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatLongDate(iso: IsoDate): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return LONG_DATE_FORMAT.format(new Date(Date.UTC(year, month - 1, day)));
}

/** `YYYY-MM-DD` -> `dd/MM`. */
function formatShortDate(iso: IsoDate): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function taskLabel(task: TaskDto): string {
  return task.fatal ? `${TASK_TYPE_LABEL[task.type]}, fatal` : TASK_TYPE_LABEL[task.type];
}

/** Prefixo antes do travessão: `dd/MM`, `dd/MM HH:mm`, `HH:mm` ou nenhum. */
function formatBulletLine(task: TaskDto, prefix: string | null): string {
  const prefixWithDash = prefix === null ? '' : `${prefix} — `;
  return `• ${prefixWithDash}${task.title} (${taskLabel(task)})`;
}

/** Seção com título e contagem; lista vazia não gera seção (por isso devolve array, para espalhar). */
function renderSection(title: string, tasks: TaskDto[], prefixOf: (task: TaskDto) => string | null): string[] {
  if (tasks.length === 0) return [];
  return [[`${title} (${tasks.length})`, ...tasks.map((task) => formatBulletLine(task, prefixOf(task)))].join('\n')];
}

/**
 * Briefing diário em texto simples (sem markdown/HTML): usado pelo painel web e pelo bot do Telegram.
 * Devolve '' quando as quatro listas estão vazias.
 */
export function renderBriefing(dto: BriefingDto): string {
  const sections = [
    ...renderSection('Atrasadas', dto.overdue, (task) => (task.dueDate === null ? null : formatShortDate(task.dueDate))),
    ...renderSection('Fatais de hoje', dto.fatalToday, (task) => task.dueTime),
    ...renderSection('Audiências de hoje', dto.hearingsToday, (task) => task.dueTime),
    ...renderSection('Próximas 48 horas', dto.nextTwoDays, (task) => {
      if (task.dueDate === null) return task.dueTime;
      return task.dueTime === null ? formatShortDate(task.dueDate) : `${formatShortDate(task.dueDate)} ${task.dueTime}`;
    }),
  ];
  if (sections.length === 0) return '';
  return ['Bom dia.', formatLongDate(dto.today), '', sections.join('\n\n')].join('\n');
}
