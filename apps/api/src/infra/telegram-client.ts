import type { TelegramClient } from '../application/ports.js';
import { classifyTelegramError } from '../domain/reminder-message.js';

const MAX_CHARS = 4096;
const DEFAULT_TIMEOUT_MS = 10_000;
/** Resposta 200 sem `message_id` utilizável ou com `ok:false` sem código: erro permanente 'outro'. */
const UNEXPECTED_BODY_STATUS = 422;

/** Até 4096 pontos de código; acima disso corta e termina com '…' (também um ponto de código). */
function truncate(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= MAX_CHARS) return text;
  return `${chars.slice(0, MAX_CHARS - 1).join('')}…`;
}

type TelegramBody = {
  ok?: boolean;
  result?: { message_id?: unknown };
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

async function readBody(response: Response): Promise<TelegramBody | null> {
  try {
    const parsed: unknown = await response.json();
    return parsed !== null && typeof parsed === 'object' ? (parsed as TelegramBody) : null;
  } catch {
    return null;
  }
}

/**
 * Cliente mínimo do Bot API (só `sendMessage`, texto simples, sem `parse_mode`). Nunca lança e
 * nunca devolve nem registra o token, o texto ou o corpo da resposta: o resultado é só a
 * classificação do erro. O token aparece unicamente no caminho da URL da requisição.
 */
export function createTelegramClient(opts: { token: string; fetch?: typeof fetch; timeoutMs?: number }): TelegramClient {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `https://api.telegram.org/bot${opts.token}/sendMessage`;

  return {
    async sendMessage(chatId, text) {
      let response: Response;
      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: truncate(text) }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return { ok: false, error: classifyTelegramError(0, null) };
      }

      const body = await readBody(response);

      if (response.ok && body !== null && body.ok === true) {
        const id = body.result?.message_id;
        if (typeof id === 'number' && Number.isFinite(id)) return { ok: true, messageId: id };
        return { ok: false, error: classifyTelegramError(UNEXPECTED_BODY_STATUS, null) };
      }

      // 200 com ok:false: o código de erro do corpo faz as vezes do status.
      const status = response.ok ? (typeof body?.error_code === 'number' ? body.error_code : UNEXPECTED_BODY_STATUS) : response.status;
      return { ok: false, error: classifyTelegramError(status, body) };
    },
  };
}
