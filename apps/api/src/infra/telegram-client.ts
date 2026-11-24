import type { InlineKeyboard, TelegramClient } from '../application/ports.js';
import { classifyTelegramError, type TelegramErrorClass } from '../domain/reminder-message.js';

/** Limite de texto de uma mensagem no Bot API. */
const MAX_MESSAGE_CHARS = 4096;
const TELEGRAM_API_BASE_URL = 'https://api.telegram.org';
const DEFAULT_TIMEOUT_MS = 10_000;
/** Status sintético para falha de rede/timeout (sem resposta HTTP). */
const NETWORK_FAILURE_STATUS = 0;
/** Resposta 200 sem `message_id` utilizável ou com `ok:false` sem código: erro permanente 'outro'. */
const UNEXPECTED_BODY_STATUS = 422;
/** `show_alert` não é usado: o aviso do botão é curto (o Telegram corta em 200 caracteres). */
const ANSWER_MAX_CHARS = 200;

/** Até 4096 pontos de código; acima disso corta e termina com '…' (também um ponto de código). */
function truncate(text: string, maxChars = MAX_MESSAGE_CHARS): string {
  const codePoints = Array.from(text);
  if (codePoints.length <= maxChars) return text;
  return `${codePoints.slice(0, maxChars - 1).join('')}…`;
}

/** Envelope de resposta do Bot API (só os campos que usamos). */
type TelegramBody = {
  ok?: boolean;
  result?: { message_id?: unknown };
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

/** Lê o JSON da resposta; corpo ausente ou inválido vira `null` (classificado como erro adiante). */
async function readBody(response: Response): Promise<TelegramBody | null> {
  try {
    const parsed: unknown = await response.json();
    return parsed !== null && typeof parsed === 'object' ? (parsed as TelegramBody) : null;
  } catch {
    return null;
  }
}

/** `inline_keyboard` do Bot API: `callbackData` vira `callback_data`, `webAppUrl` vira `web_app.url`, `url` vira `url`. */
function toReplyMarkup(keyboard: InlineKeyboard): { inline_keyboard: unknown[][] } {
  return {
    inline_keyboard: keyboard.map((row) =>
      row.map((button) =>
        'callbackData' in button
          ? { text: button.text, callback_data: button.callbackData }
          : 'url' in button
            ? { text: button.text, url: button.url }
            : { text: button.text, web_app: { url: button.webAppUrl } },
      ),
    ),
  };
}

/**
 * Cliente mínimo do Bot API (`sendMessage`, `editMessageText`, `answerCallbackQuery`; texto simples, sem
 * `parse_mode`). Nunca lança e nunca devolve nem registra o token, o texto ou o corpo da resposta: o
 * resultado é só a classificação do erro. O token aparece unicamente no caminho da URL da requisição.
 */
export function createTelegramClient(opts: { token: string; fetch?: typeof fetch; timeoutMs?: number }): TelegramClient {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const methodUrl = (method: string) => `${TELEGRAM_API_BASE_URL}/bot${opts.token}/${method}`;

  /** `ok: true` traz o corpo; o resto é a classificação do erro. */
  async function callBotApi(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<{ ok: true; body: TelegramBody } | { ok: false; error: TelegramErrorClass }> {
    let response: Response;
    try {
      response = await doFetch(methodUrl(method), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, error: classifyTelegramError(NETWORK_FAILURE_STATUS, null) };
    }

    const body = await readBody(response);
    if (response.ok && body !== null && body.ok === true) return { ok: true, body };

    // 200 com ok:false: o código de erro do corpo faz as vezes do status.
    const bodyErrorStatus = typeof body?.error_code === 'number' ? body.error_code : UNEXPECTED_BODY_STATUS;
    const status = response.ok ? bodyErrorStatus : response.status;
    return { ok: false, error: classifyTelegramError(status, body) };
  }

  return {
    async sendMessage(chatId, text, options) {
      const result = await callBotApi('sendMessage', {
        chat_id: chatId,
        text: truncate(text),
        ...(options?.keyboard !== undefined ? { reply_markup: toReplyMarkup(options.keyboard) } : {}),
      });
      if (!result.ok) return result;
      const messageId = result.body.result?.message_id;
      if (typeof messageId === 'number' && Number.isFinite(messageId)) return { ok: true, messageId };
      return { ok: false, error: classifyTelegramError(UNEXPECTED_BODY_STATUS, null) };
    },

    async editMessageText(chatId, messageId, text, options) {
      const result = await callBotApi('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: truncate(text),
        // Sem teclado, manda a lista vazia: é assim que o Telegram remove os botões antigos.
        reply_markup: toReplyMarkup(options?.keyboard ?? []),
      });
      return result.ok ? { ok: true } : result;
    },

    async answerCallbackQuery(callbackQueryId, text) {
      const result = await callBotApi('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        ...(text !== undefined ? { text: truncate(text, ANSWER_MAX_CHARS) } : {}),
      });
      return result.ok ? { ok: true } : result;
    },
  };
}
