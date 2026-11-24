import { type IsoDate, TASK_TYPE_LABEL, type TaskType } from '@nexus/shared';
import type { ReminderKind } from './reminders.js';

const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1000;
const MAX_TITLE_CHARS = 200;
const LATE_THRESHOLD_MS = 5 * MS_PER_MINUTE;
const UNTITLED = 'Sem título';

/** Texto simples: espaços colapsados, no máximo 200 pontos de código, nunca vazio. */
export function sanitizeTitle(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return UNTITLED;
  // `Array.from` separa por ponto de código: não corta um emoji (par substituto) ao meio.
  const codePoints = Array.from(collapsed);
  if (codePoints.length <= MAX_TITLE_CHARS) return collapsed;
  return `${codePoints.slice(0, MAX_TITLE_CHARS - 1).join('')}…`;
}

/** Texto do lembrete enviado pelo bot, conforme o tipo de lembrete; `late` acrescenta "(atrasado)". */
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
  const typeLabel = TASK_TYPE_LABEL[taskType];
  // Prazo fatal se anuncia como tal nos avisos por dia; nos avisos por horário vale o tipo.
  const dayNoticeLabel = fatal ? 'Prazo fatal' : typeLabel;
  const [, month, day] = dueDate.split('-');
  const dayMonth = `${day}/${month}`;

  let message: string;
  if (kind === 'tres_dias') {
    message = `Prazo fatal em 3 dias, ${dayMonth}: ${title}`;
  } else if (kind === 'dia_anterior') {
    message = `${dayNoticeLabel} amanhã, ${dayMonth}: ${title}`;
  } else if (kind === 'antecipado' && dueTime !== null) {
    message = `${typeLabel} às ${dueTime} (em breve): ${title}`;
  } else if (kind === 'no_horario' && dueTime !== null) {
    message = `${typeLabel} agora, às ${dueTime}: ${title}`;
  } else {
    message = `${dayNoticeLabel} hoje, ${dayMonth}: ${title}`;
  }
  return late ? `${message} (atrasado)` : message;
}

/** Atrasado = mais de 5 minutos além do horário reservado (5:00 exatos não conta). */
export function isLate(scheduledAt: Date, now: Date): boolean {
  return now.getTime() - scheduledAt.getTime() > LATE_THRESHOLD_MS;
}

/** Esperas entre tentativas de envio: 1 min, 5 min, 15 min, 1 h. */
const RETRY_DELAYS_MS = [1, 5, 15, 60].map((minutes) => minutes * MS_PER_MINUTE);

/** Espera antes da próxima tentativa; `null` quando as tentativas se esgotaram (a partir da 5ª). */
export function retryDelayMs(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError(`attempt must be an integer >= 1, got ${attempt}`);
  }
  return RETRY_DELAYS_MS[attempt - 1] ?? null;
}

/** Erro do Telegram classificado: `transient` vale nova tentativa; `permanent` não. */
export type TelegramErrorClass =
  | { kind: 'transient'; retryAfterMs?: number }
  | { kind: 'permanent'; reason: 'bot_bloqueado' | 'chat_inexistente' | 'outro' };

const NETWORK_FAILURE_STATUS = 0;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;

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

  if (status === HTTP_FORBIDDEN) return { kind: 'permanent', reason: 'bot_bloqueado' };
  if (status === HTTP_BAD_REQUEST) {
    return {
      kind: 'permanent',
      reason: description.includes('chat not found') ? 'chat_inexistente' : 'outro',
    };
  }
  if (status === HTTP_TOO_MANY_REQUESTS) {
    const retryAfter =
      body !== null && typeof body === 'object' && body.parameters !== null && typeof body.parameters === 'object'
        ? body.parameters.retry_after
        : undefined;
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0) {
      return { kind: 'transient', retryAfterMs: retryAfter * MS_PER_SECOND };
    }
    return { kind: 'transient' };
  }
  const isServerError = status >= 500 && status <= 599;
  if (status === NETWORK_FAILURE_STATUS || status === HTTP_REQUEST_TIMEOUT || isServerError) {
    return { kind: 'transient' };
  }
  return { kind: 'permanent', reason: 'outro' };
}
