import type { IsoDate, TaskType } from '@aj/shared';
import type { ReminderKind } from './reminders.js';

const TYPE_LABEL: Record<TaskType, string> = {
  prazo: 'Prazo',
  tarefa: 'Tarefa',
  audiencia: 'Audiência',
};

const MAX_TITLE_CHARS = 200;
const LATE_THRESHOLD_MS = 5 * 60_000;

/** Texto simples: espaços colapsados, no máximo 200 pontos de código, nunca vazio. */
export function sanitizeTitle(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return 'Sem título';
  const chars = Array.from(collapsed);
  if (chars.length <= MAX_TITLE_CHARS) return collapsed;
  return `${chars.slice(0, MAX_TITLE_CHARS - 1).join('')}…`;
}

export function renderReminder(input: {
  kind: ReminderKind;
  title: string;
  taskType: TaskType;
  dueDate: IsoDate;
  dueTime: string | null;
  fatal: boolean;
  late: boolean;
}): string {
  const { kind, taskType, dueDate, dueTime, fatal, late } = input;
  const title = sanitizeTitle(input.title);
  const type = TYPE_LABEL[taskType];
  const label = fatal ? 'Prazo fatal' : type;
  const [, month, day] = dueDate.split('-');
  const dayMonth = `${day}/${month}`;

  let text: string;
  if (kind === 'tres_dias') {
    text = `Prazo fatal em 3 dias, ${dayMonth}: ${title}`;
  } else if (kind === 'dia_anterior') {
    text = `${label} amanhã, ${dayMonth}: ${title}`;
  } else if (kind === 'antecipado' && dueTime !== null) {
    text = `${type} às ${dueTime} (em breve): ${title}`;
  } else if (kind === 'no_horario' && dueTime !== null) {
    text = `${type} agora, às ${dueTime}: ${title}`;
  } else {
    text = `${label} hoje, ${dayMonth}: ${title}`;
  }
  return late ? `${text} (atrasado)` : text;
}

/** Atrasado = mais de 5 minutos além do horário reservado (5:00 exatos não conta). */
export function isLate(scheduledAt: Date, now: Date): boolean {
  return now.getTime() - scheduledAt.getTime() > LATE_THRESHOLD_MS;
}

const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000] as const;

/** Espera antes da próxima tentativa; `null` quando as tentativas se esgotaram (a partir da 5ª). */
export function retryDelayMs(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError(`attempt must be an integer >= 1, got ${attempt}`);
  }
  return RETRY_DELAYS_MS[attempt - 1] ?? null;
}

export type TelegramErrorClass =
  | { kind: 'transient'; retryAfterMs?: number }
  | { kind: 'permanent'; reason: 'bot_bloqueado' | 'chat_inexistente' | 'outro' };

type TelegramErrorBody = {
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

/**
 * Classifica pelo status HTTP primeiro (Ruling 15); a descrição só distingue o motivo
 * dentro de 400. Status 0 = falha de rede. Nunca lança, qualquer que seja o corpo.
 */
export function classifyTelegramError(
  status: number,
  body: TelegramErrorBody | null | undefined,
): TelegramErrorClass {
  const description =
    body !== null && typeof body === 'object' && typeof body.description === 'string'
      ? body.description.toLowerCase()
      : '';

  if (status === 403) return { kind: 'permanent', reason: 'bot_bloqueado' };
  if (status === 400) {
    return {
      kind: 'permanent',
      reason: description.includes('chat not found') ? 'chat_inexistente' : 'outro',
    };
  }
  if (status === 429) {
    const retryAfter =
      body !== null && typeof body === 'object' && body.parameters !== null && typeof body.parameters === 'object'
        ? body.parameters.retry_after
        : undefined;
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0) {
      return { kind: 'transient', retryAfterMs: retryAfter * 1000 };
    }
    return { kind: 'transient' };
  }
  if (status === 0 || status === 408 || (status >= 500 && status <= 599)) return { kind: 'transient' };
  return { kind: 'permanent', reason: 'outro' };
}
