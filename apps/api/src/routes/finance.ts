import { Hono, type MiddlewareHandler } from 'hono';
import {
  createFinanceEntryInputSchema,
  listFinanceEntriesQuerySchema,
  updateFinanceEntryInputSchema,
} from '@aj/shared';
import type { makeFinanceUseCases } from '../application/finance.js';
import { ValidationError } from '../http-errors.js';
import { idParam, readJson } from './request.js';

export function financeRoutes(
  deps: { finance: ReturnType<typeof makeFinanceUseCases> },
  auth: MiddlewareHandler,
): Hono<{ Variables: { userId: string } }> {
  const routes = new Hono<{ Variables: { userId: string } }>();
  routes.use('*', auth);

  // userId vem só do token verificado (c.get('userId')), nunca do corpo, query ou path.
  routes.get('/', async (c) => {
    const parsed = listFinanceEntriesQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    return c.json(await deps.finance.list(c.get('userId'), parsed.data));
  });

  routes.post('/', async (c) => {
    const parsed = createFinanceEntryInputSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    return c.json(await deps.finance.create(c.get('userId'), parsed.data), 201);
  });

  routes.patch('/:id', async (c) => {
    const id = idParam(c, 'lancamento');
    const parsed = updateFinanceEntryInputSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    return c.json(await deps.finance.update(c.get('userId'), id, parsed.data));
  });

  routes.delete('/:id', async (c) => {
    await deps.finance.remove(c.get('userId'), idParam(c, 'lancamento'));
    return c.body(null, 204);
  });

  return routes;
}
