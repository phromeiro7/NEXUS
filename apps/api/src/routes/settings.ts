import { Hono, type MiddlewareHandler } from 'hono';
import { updateSettingsInputSchema } from '@aj/shared';
import type { makeSettingsUseCases } from '../application/settings.js';
import { ValidationError } from '../http-errors.js';
import { readJson } from './request.js';

export function settingsRoutes(
  deps: { settings: ReturnType<typeof makeSettingsUseCases> },
  auth: MiddlewareHandler,
): Hono<{ Variables: { userId: string } }> {
  const routes = new Hono<{ Variables: { userId: string } }>();
  routes.use('*', auth);

  routes.get('/', async (c) => c.json(await deps.settings.get(c.get('userId'))));

  routes.patch('/', async (c) => {
    const parsed = updateSettingsInputSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    return c.json(await deps.settings.update(c.get('userId'), parsed.data));
  });

  return routes;
}
