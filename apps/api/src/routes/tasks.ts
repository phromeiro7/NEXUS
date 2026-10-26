import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { createTaskInputSchema, listTasksQuerySchema, updateTaskInputSchema } from '@aj/shared';
import type { makeTaskUseCases } from '../application/tasks.js';
import { NotFoundError } from '../application/errors.js';
import { ValidationError } from '../http-errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError([{ code: 'custom', path: [], message: 'Corpo JSON inválido ou ausente' }]);
  }
}

/** Um id malformado é tratado como tarefa inexistente (mesma resposta), antes do caso de uso. */
function taskId(c: Context): string {
  const id = c.req.param('id') ?? '';
  if (!UUID.test(id)) throw new NotFoundError('tarefa');
  return id;
}

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

  routes.get('/:id', async (c) => c.json(await deps.tasks.get(c.get('userId'), taskId(c))));

  routes.patch('/:id', async (c) => {
    const id = taskId(c);
    const parsed = updateTaskInputSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    return c.json(await deps.tasks.update(c.get('userId'), id, parsed.data));
  });

  routes.delete('/:id', async (c) => {
    await deps.tasks.remove(c.get('userId'), taskId(c));
    return c.body(null, 204);
  });

  return routes;
}
