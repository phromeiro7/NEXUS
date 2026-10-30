import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { SchedulerResult } from '../application/scheduler.js';

/** Compara em tempo constante: os dois lados viram SHA-256 (32 bytes), então o tamanho nunca vaza nem lança. */
function secretsMatch(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/**
 * Rotas internas (agendador). SEM autenticação de usuário: exigem `X-Internal-Secret`.
 * Falha fechada: sem segredo configurado (ou sem agendador) a rota responde 503 antes de olhar o cabeçalho.
 */
export function internalRoutes(deps: {
  scheduler?: () => Promise<SchedulerResult>;
  internalSecret?: string;
}): Hono {
  const routes = new Hono();

  routes.post('/reminders/run', async (c) => {
    const expected = deps.internalSecret;
    if (expected === undefined || expected === '' || deps.scheduler === undefined) {
      return c.json({ error: 'agendador_desabilitado' }, 503);
    }
    const given = c.req.header('x-internal-secret') ?? '';
    if (!secretsMatch(given, expected)) return c.json({ error: 'nao_autenticado' }, 401);
    return c.json(await deps.scheduler());
  });

  return routes;
}
