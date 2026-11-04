import { Hono } from 'hono';
import { telegramAuthInputSchema, type TelegramAuthResultDto } from '@aj/shared';
import { TelegramAuthError } from '../application/errors.js';
import { ValidationError } from '../http-errors.js';

export type AuthRoutesDeps = {
  /** Ausente = login pelo Telegram desligado: 503 'login_desabilitado'. */
  telegramLogin?: (input: { initData: string; ip: string }) => Promise<TelegramAuthResultDto>;
};

/** Origem da requisição para o limite por IP. Atrás de proxy/túnel vale o primeiro IP encaminhado. */
function clientIp(headers: (name: string) => string | undefined): string {
  const forwarded = headers('cf-connecting-ip') ?? headers('x-forwarded-for')?.split(',')[0];
  const ip = forwarded?.trim();
  return ip !== undefined && ip !== '' ? ip.slice(0, 64) : 'desconhecido';
}

/**
 * Rotas de autenticação SEM Bearer: a prova de identidade é a assinatura do `initData`, conferida no
 * caso de uso. Respostas nunca trazem `initData`, token do bot nem identificadores do usuário.
 */
export function authRoutes(deps: AuthRoutesDeps): Hono {
  const routes = new Hono();

  routes.post('/telegram', async (c) => {
    if (deps.telegramLogin === undefined) throw new TelegramAuthError('login_desabilitado');
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new ValidationError([]);
    }
    const parsed = telegramAuthInputSchema.safeParse(body);
    // Só o formato do campo; o conteúdo do corpo não é devolvido.
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => ({ path: i.path, code: i.code })));
    const result = await deps.telegramLogin({
      initData: parsed.data.initData,
      ip: clientIp((name) => c.req.header(name)),
    });
    c.header('Cache-Control', 'no-store');
    return c.json(result);
  });

  return routes;
}
