import { Hono } from 'hono';
import { calculateDeadlineInputSchema } from '@aj/shared';
import { authMiddleware, type AuthVerifier } from './auth.js';
import type { makeCalculateDeadline } from './application/calculate-deadline.js';

export type AppDeps = {
  verifyToken: AuthVerifier;
  calculateDeadline: ReturnType<typeof makeCalculateDeadline>;
};

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();

  app.onError((err, c) => {
    // Só o erro: nunca headers, token ou config. O cliente recebe a resposta genérica.
    console.error('[api] erro não tratado', err);
    return c.json({ error: 'erro_interno' }, 500);
  });

  app.get('/health', (c) => c.json({ status: 'ok' }));

  const auth = authMiddleware(deps.verifyToken);

  app.get('/me', auth, (c) => c.json({ userId: c.get('userId') }));

  app.post('/deadlines/calculate', auth, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'entrada_invalida' }, 400);
    }
    const parsed = calculateDeadlineInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'entrada_invalida', issues: parsed.error.issues }, 400);
    }
    // userId vem só do token verificado, nunca do corpo.
    return c.json(await deps.calculateDeadline(c.get('userId'), parsed.data));
  });

  return app;
}
