import type { MiddlewareHandler } from 'hono';

/** Valida o token de acesso; `null` = não autenticado. */
export type AuthVerifier = (token: string) => Promise<{ userId: string } | null>;

const BEARER_TOKEN_PATTERN = /^Bearer\s+(\S+)$/i;

/** Exige `Authorization: Bearer <token>` válido e define `userId` no contexto. */
export function authMiddleware(verifyToken: AuthVerifier): MiddlewareHandler {
  return async (c, next) => {
    const token = BEARER_TOKEN_PATTERN.exec(c.req.header('Authorization') ?? '')?.[1];
    const user = token ? await verifyToken(token) : null;
    if (!user) return c.json({ error: 'nao_autenticado' }, 401);
    c.set('userId', user.userId);
    await next();
  };
}
