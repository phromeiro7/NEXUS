import { Hono } from 'hono';
import {
  QR_LOGIN_POLL_HEADER,
  telegramAuthInputSchema,
  type QrLoginCreateResultDto,
  type QrLoginStatusDto,
  type TelegramAuthResultDto,
} from '@aj/shared';
import { TelegramAuthError } from '../application/errors.js';
import { ValidationError } from '../http-errors.js';

export type AuthRoutesDeps = {
  /** Ausente = login pelo Telegram desligado: 503 'login_desabilitado'. */
  telegramLogin?: (input: { initData: string; ip: string }) => Promise<TelegramAuthResultDto>;
  /** Login do painel por QR code; ausente = desligado (503 'login_desabilitado'). */
  qrLogin?: {
    create(input: { ip: string; userAgent: string | undefined }): Promise<QrLoginCreateResultDto>;
    status(input: { id: string; pollSecret: string | undefined }): Promise<QrLoginStatusDto>;
  };
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

  // Painel: o navegador cria o pedido e o consulta com o segredo que só ele tem. Nada aqui devolve nonce,
  // segredo guardado nem identificadores da conta; o token de sessão sai uma vez, na aprovação.
  routes.post('/qr', async (c) => {
    if (deps.qrLogin === undefined) throw new TelegramAuthError('login_desabilitado');
    const result = await deps.qrLogin.create({
      ip: clientIp((name) => c.req.header(name)),
      userAgent: c.req.header('user-agent'),
    });
    c.header('Cache-Control', 'no-store');
    return c.json(result, 201);
  });

  routes.get('/qr/:id', async (c) => {
    if (deps.qrLogin === undefined) throw new TelegramAuthError('login_desabilitado');
    const result = await deps.qrLogin.status({
      id: c.req.param('id'),
      pollSecret: c.req.header(QR_LOGIN_POLL_HEADER),
    });
    c.header('Cache-Control', 'no-store');
    return c.json(result);
  });

  return routes;
}
