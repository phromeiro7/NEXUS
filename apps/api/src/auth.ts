import type { MiddlewareHandler } from 'hono';

export type AuthVerifier = (token: string) => Promise<{ userId: string } | null>;

const BEARER = /^Bearer\s+(\S+)$/i;

/** Exige `Authorization: Bearer <token>` válido e define `userId` no contexto. */
export function authMiddleware(verify: AuthVerifier): MiddlewareHandler {
  return async (c, next) => {
    const token = BEARER.exec(c.req.header('Authorization') ?? '')?.[1];
    const user = token ? await verify(token) : null;
    if (!user) return c.json({ error: 'nao_autenticado' }, 401);
    c.set('userId', user.userId);
    await next();
  };
}
