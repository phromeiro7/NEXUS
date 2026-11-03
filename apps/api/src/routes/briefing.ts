import { Hono, type MiddlewareHandler } from 'hono';
import type { BriefingDto } from '@aj/shared';

export function briefingRoutes(
  deps: { briefing: (userId: string) => Promise<BriefingDto> },
  auth: MiddlewareHandler,
): Hono<{ Variables: { userId: string } }> {
  const routes = new Hono<{ Variables: { userId: string } }>();
  routes.use('*', auth);

  routes.get('/', async (c) => c.json(await deps.briefing(c.get('userId'))));

  return routes;
}
