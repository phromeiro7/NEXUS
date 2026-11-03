import { z } from 'zod';
import type { BriefingDto } from './briefing.js';
import type { IsoDate } from './primitives.js';
import type { TaskDto } from './task-api.js';
import type { TaskType } from './task.js';

export const assistantMessageInputSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  clientMessageId: z.uuid(),
});
export type AssistantMessageInput = z.infer<typeof assistantMessageInputSchema>;

/** `affectedTasks`: tasks created/changed/completed in this cycle, without repeated ids. */
export type AssistantReplyDto = { reply: string; affectedTasks: TaskDto[] };

const TYPE_LABEL: Record<TaskType, string> = {
  prazo: 'Prazo',
  tarefa: 'Tarefa',
  audiencia: 'Audiência',
};

const LONG_DATE = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function longDate(iso: IsoDate): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return LONG_DATE.format(new Date(Date.UTC(y, m - 1, d)));
}

/** `YYYY-MM-DD` -> `dd/MM`. */
function shortDate(iso: IsoDate): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function label(t: TaskDto): string {
  return t.fatal ? `${TYPE_LABEL[t.type]}, fatal` : TYPE_LABEL[t.type];
}

/** Prefix before the dash: `dd/MM`, `dd/MM HH:mm`, `HH:mm` or none. */
function bullet(t: TaskDto, prefix: string | null): string {
  const head = prefix === null ? '' : `${prefix} — `;
  return `• ${head}${t.title} (${label(t)})`;
}

function section(title: string, items: TaskDto[], prefix: (t: TaskDto) => string | null): string[] {
  if (items.length === 0) return [];
  return [[`${title} (${items.length})`, ...items.map((t) => bullet(t, prefix(t)))].join('\n')];
}

/**
 * Plain-text daily briefing (no markdown/HTML): shared by the web panel and the Telegram bot.
 * Returns '' when all four lists are empty.
 */
export function renderBriefing(dto: BriefingDto): string {
  const sections = [
    ...section('Atrasadas', dto.overdue, (t) => (t.dueDate === null ? null : shortDate(t.dueDate))),
    ...section('Fatais de hoje', dto.fatalToday, (t) => t.dueTime),
    ...section('Audiências de hoje', dto.hearingsToday, (t) => t.dueTime),
    ...section('Próximas 48 horas', dto.nextTwoDays, (t) => {
      if (t.dueDate === null) return t.dueTime;
      return t.dueTime === null ? shortDate(t.dueDate) : `${shortDate(t.dueDate)} ${t.dueTime}`;
    }),
  ];
  if (sections.length === 0) return '';
  return ['Bom dia.', longDate(dto.today), '', sections.join('\n\n')].join('\n');
}
