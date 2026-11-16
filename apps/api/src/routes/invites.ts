import { Hono, type MiddlewareHandler } from 'hono';
import { createInviteInputSchema, inviteCodeSchema, type InviteDto, type InviteListDto, type InviteSummaryDto } from '@nexus/shared';
import { NotFoundError } from '../application/errors.js';
import { ValidationError } from '../http-errors.js';

export type InviteRoutesDeps = {
  invites: {
    create(userId: string, label?: string): Promise<InviteDto>;
    list(userId: string): Promise<InviteDto[]>;
    summary(userId: string): Promise<InviteSummaryDto>;
    remove(userId: string, code: string): Promise<void>;
  };
};

/**
 * Convites (só administradores; os casos de uso respondem 403 aos demais). `userId` vem só do token
 * verificado. A resposta não traz identificadores de quem usou o convite. DELETE apaga o convite e, se já
 * foi usado, bloqueia a conta de quem o usou.
 */
export function inviteRoutes(deps: InviteRoutesDeps, auth: MiddlewareHandler): Hono<{ Variables: { userId: string } }> {
  const routes = new Hono<{ Variables: { userId: string } }>();
  routes.use('*', auth);

  routes.get('/', async (c) => {
    const userId = c.get('userId');
    const body: InviteListDto = { invites: await deps.invites.list(userId), summary: await deps.invites.summary(userId) };
    c.header('Cache-Control', 'no-store');
    return c.json(body);
  });

  routes.post('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    // O corpo é opcional (clientes antigos não mandam nada).
    const raw: unknown = await c.req.json().catch(() => ({}));
    const parsed = createInviteInputSchema.safeParse(raw ?? {});
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    return c.json(await deps.invites.create(c.get('userId'), parsed.data.label), 201);
  });

  routes.delete('/:code', async (c) => {
    const parsed = inviteCodeSchema.safeParse(c.req.param('code'));
    if (!parsed.success) throw new NotFoundError('convite');
    await deps.invites.remove(c.get('userId'), parsed.data);
    return c.body(null, 204);
  });

  return routes;
}
