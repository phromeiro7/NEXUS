import { Hono, type MiddlewareHandler } from 'hono';
import { assistantMessageInputSchema, type AssistantReplyDto } from '@nexus/shared';
import type { ProcessMessageInput } from '../application/assistant/process-message.js';
import { ValidationError } from '../http-errors.js';
import { readJson } from './request.js';

export type ProcessMessage = (input: ProcessMessageInput) => Promise<AssistantReplyDto>;

export function assistantRoutes(
  deps: { processMessage: ProcessMessage | undefined },
  auth: MiddlewareHandler,
): Hono<{ Variables: { userId: string } }> {
  const routes = new Hono<{ Variables: { userId: string } }>();
  routes.use('*', auth);

  routes.post('/message', async (c) => {
    const parsed = assistantMessageInputSchema.safeParse(await readJson(c));
    // Só código e caminho de cada problema: o texto do usuário nunca volta na resposta.
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => ({ code: i.code, path: i.path })));
    }
    // Assistente desabilitado (sem chave): o resto da API segue funcionando.
    if (deps.processMessage === undefined) {
      return c.json({ error: 'assistente_indisponivel', reason: 'configuracao' }, 503);
    }
    // userId vem só do token verificado, nunca do corpo.
    const reply = await deps.processMessage({
      userId: c.get('userId'),
      channel: 'painel',
      externalId: parsed.data.clientMessageId,
      text: parsed.data.text,
      source: 'painel',
    });
    return c.json(reply);
  });

  return routes;
}
