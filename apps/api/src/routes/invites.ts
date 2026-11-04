import { Hono, type MiddlewareHandler } from 'hono';
import { inviteCodeSchema, type InviteDto, type InviteListDto } from '@aj/shared';
import { NotFoundError } from '../application/errors.js';

export type InviteRoutesDeps = {
  invites: {
    create(userId: string): Promise<InviteDto>;
    list(userId: string): Promise<InviteDto[]>;
    revoke(userId: string, code: string): Promise<void>;
  };
};

/**
 * Convites (só administradores; os casos de uso respondem 403 aos demais). `userId` vem só do token
 * verificado. A resposta não traz identificadores de quem usou o convite.
 */
export function inviteRoutes(deps: InviteRoutesDeps, auth: MiddlewareHandler): Hono<{ Variables: { userId: string } }> {
  const routes = new Hono<{ Variables: { userId: string } }>();
  routes.use('*', auth);

  routes.get('/', async (c) => {
    const body: InviteListDto = { invites: await deps.invites.list(c.get('userId')) };
    c.header('Cache-Control', 'no-store');
    return c.json(body);
  });

  routes.post('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(await deps.invites.create(c.get('userId')), 201);
  });

  routes.delete('/:code', async (c) => {
    const parsed = inviteCodeSchema.safeParse(c.req.param('code'));
    if (!parsed.success) throw new NotFoundError('convite');
    await deps.invites.revoke(c.get('userId'), parsed.data);
    return c.body(null, 204);
  });

  return routes;
}
