import { Hono, type MiddlewareHandler } from 'hono';
import { createTaskInputSchema, listTasksQuerySchema, updateTaskInputSchema } from '@nexus/shared';
import type { makeTaskUseCases } from '../application/tasks.js';
import { ValidationError } from '../http-errors.js';
import { idParam, readJson } from './request.js';

export function tasksRoutes(
  deps: { tasks: ReturnType<typeof makeTaskUseCases> },
  auth: MiddlewareHandler,
): Hono<{ Variables: { userId: string } }> {
  const routes = new Hono<{ Variables: { userId: string } }>();
  routes.use('*', auth);

  // userId vem só do token verificado (c.get('userId')), nunca do corpo, query ou path.
  routes.get('/', async (c) => {
    const raw: Record<string, string | string[]> = {};
    for (const [key, values] of Object.entries(c.req.queries())) {
      raw[key] = values.length === 1 ? values[0]! : values;
    }
    const parsed = listTasksQuerySchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    return c.json(await deps.tasks.list(c.get('userId'), parsed.data));
  });

  routes.post('/', async (c) => {
    const parsed = createTaskInputSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    return c.json(await deps.tasks.create(c.get('userId'), parsed.data), 201);
  });

  routes.get('/:id', async (c) => c.json(await deps.tasks.get(c.get('userId'), idParam(c, 'tarefa'))));

  routes.patch('/:id', async (c) => {
    const id = idParam(c, 'tarefa');
    const parsed = updateTaskInputSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    return c.json(await deps.tasks.update(c.get('userId'), id, parsed.data));
  });

  routes.delete('/:id', async (c) => {
    await deps.tasks.remove(c.get('userId'), idParam(c, 'tarefa'));
    return c.body(null, 204);
  });

  return routes;
}
