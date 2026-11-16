import { Hono, type MiddlewareHandler } from 'hono';
import { createHolidayInputSchema } from '@nexus/shared';
import type { makeHolidayUseCases } from '../application/holidays.js';
import { ValidationError } from '../http-errors.js';
import { idParam, readJson } from './request.js';

export function holidaysRoutes(
  deps: { holidays: ReturnType<typeof makeHolidayUseCases> },
  auth: MiddlewareHandler,
): Hono<{ Variables: { userId: string } }> {
  const routes = new Hono<{ Variables: { userId: string } }>();
  routes.use('*', auth);

  routes.get('/', async (c) => c.json(await deps.holidays.list(c.get('userId'))));

  routes.post('/', async (c) => {
    const parsed = createHolidayInputSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    return c.json(await deps.holidays.create(c.get('userId'), parsed.data), 201);
  });

  routes.delete('/:id', async (c) => {
    await deps.holidays.remove(c.get('userId'), idParam(c, 'feriado'));
    return c.body(null, 204);
  });

  return routes;
}
