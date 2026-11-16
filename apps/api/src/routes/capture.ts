import { Hono, type MiddlewareHandler } from 'hono';
import { interpretCaptureInputSchema } from '@nexus/shared';
import type { makeCaptureInterpretUseCases } from '../application/capture-interpret.js';
import { ValidationError } from '../http-errors.js';
import { readJson } from './request.js';

export function captureRoutes(
  deps: { capture: ReturnType<typeof makeCaptureInterpretUseCases> },
  auth: MiddlewareHandler,
): Hono<{ Variables: { userId: string } }> {
  const routes = new Hono<{ Variables: { userId: string } }>();
  routes.use('*', auth);

  // Só interpreta: nada é gravado. userId vem só do token verificado.
  routes.post('/interpret', async (c) => {
    const parsed = interpretCaptureInputSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    c.header('Cache-Control', 'no-store');
    return c.json(await deps.capture.interpret(c.get('userId'), parsed.data));
  });

  return routes;
}
