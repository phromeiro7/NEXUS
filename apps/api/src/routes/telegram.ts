import { Hono, type MiddlewareHandler } from 'hono';
import type { LinkCodeDto } from '@aj/shared';
import type { AssistantLogger } from '../application/assistant/process-message.js';
import { secretsMatch } from './secret.js';

export type TelegramRoutesDeps = {
  link: { createCode(userId: string): Promise<LinkCodeDto>; unlink(userId: string): Promise<void> };
  /** Ausente (ou sem segredo) = webhook desabilitado: 503 antes de olhar o cabeçalho. */
  handleUpdate?: (update: unknown) => Promise<void>;
  /** Nunca logar. */
  webhookSecret?: string;
  logger?: AssistantLogger;
};

/**
 * Rotas do Telegram. `link-codes` e `link` exigem usuário autenticado; o webhook NÃO: ele exige o
 * cabeçalho `X-Telegram-Bot-Api-Secret-Token`. Depois do segredo, a resposta é sempre 200
 * (erros do tratamento viram log só com o nome do erro), senão o Telegram reenviaria para sempre.
 */
export function telegramRoutes(deps: TelegramRoutesDeps, auth: MiddlewareHandler): Hono<{ Variables: { userId: string } }> {
  const routes = new Hono<{ Variables: { userId: string } }>();

  routes.post('/link-codes', auth, async (c) => c.json(await deps.link.createCode(c.get('userId'))));

  routes.delete('/link', auth, async (c) => {
    await deps.link.unlink(c.get('userId'));
    return c.body(null, 204);
  });

  routes.post('/webhook', async (c) => {
    const expected = deps.webhookSecret;
    if (expected === undefined || expected === '' || deps.handleUpdate === undefined) {
      return c.json({ error: 'webhook_desabilitado' }, 503);
    }
    const given = c.req.header('x-telegram-bot-api-secret-token') ?? '';
    if (!secretsMatch(given, expected)) return c.json({ error: 'nao_autenticado' }, 401);

    let update: unknown = null;
    try {
      update = JSON.parse(await c.req.text());
    } catch {
      return c.json({ ok: true });
    }
    try {
      await deps.handleUpdate(update);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'desconhecido';
      if (deps.logger) deps.logger.error('telegram.webhook_failed', { errorName: name });
      else console.error(JSON.stringify({ level: 'error', event: 'telegram.webhook_failed', errorName: name }));
    }
    return c.json({ ok: true });
  });

  return routes;
}
