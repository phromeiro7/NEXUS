import { Hono, type MiddlewareHandler } from 'hono';
import { caseStatusSchema, createCaseInputSchema, updateCaseInputSchema } from '@nexus/shared';
import type { makeCaseUseCases } from '../application/cases.js';
import { ValidationError } from '../http-errors.js';
import { idParam, readJson } from './request.js';

export function casesRoutes(
  deps: { cases: ReturnType<typeof makeCaseUseCases> },
  auth: MiddlewareHandler,
): Hono<{ Variables: { userId: string } }> {
  const routes = new Hono<{ Variables: { userId: string } }>();
  routes.use('*', auth);

  // userId vem só do token verificado (c.get('userId')), nunca do corpo, query ou path.
  routes.get('/', async (c) => {
    const raw = c.req.query('status');
    let status: 'ativo' | 'arquivado' | undefined;
    if (raw !== undefined) {
      const parsed = caseStatusSchema.safeParse(raw);
      if (!parsed.success) throw new ValidationError(parsed.error.issues);
      status = parsed.data;
    }
    return c.json(await deps.cases.list(c.get('userId'), status === undefined ? {} : { status }));
  });

  routes.post('/', async (c) => {
    const parsed = createCaseInputSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    return c.json(await deps.cases.create(c.get('userId'), parsed.data), 201);
  });

  routes.get('/:id', async (c) => c.json(await deps.cases.get(c.get('userId'), idParam(c, 'processo'))));

  routes.patch('/:id', async (c) => {
    const id = idParam(c, 'processo');
    const parsed = updateCaseInputSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    return c.json(await deps.cases.update(c.get('userId'), id, parsed.data));
  });

  return routes;
}
