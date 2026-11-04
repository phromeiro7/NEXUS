import { z } from 'zod';

/**
 * Login do painel por QR code. O navegador pede um pedido (`POST /auth/qr`), mostra o `deepLink` como QR,
 * e a pessoa confirma no Telegram. `pollSecret` só existe no navegador que criou o pedido: sem ele ninguém
 * recebe o token de sessão, mesmo conhecendo o `id`.
 */
export const qrLoginCreateResultSchema = z.object({
  id: z.uuid(),
  pollSecret: z.string().min(16).max(128),
  /** https://t.me/<bot>?start=login_<nonce> */
  deepLink: z.string().max(256),
  expiresAt: z.string(),
});
export type QrLoginCreateResultDto = z.infer<typeof qrLoginCreateResultSchema>;

/** Cabeçalho com o segredo de consulta em `GET /auth/qr/:id`. */
export const QR_LOGIN_POLL_HEADER = 'X-Poll-Secret';

/**
 * `aguardando`: ninguém abriu o link. `confirmar`: o bot já perguntou e espera a resposta. `aprovado`: só
 * vem COM `tokenHash` (entregue uma vez). `negado`: a pessoa tocou em "Não fui eu". `recusado`: o Telegram
 * não tem conta. `expirado`: passou da validade.
 */
export const QR_LOGIN_STATUSES = ['aguardando', 'confirmar', 'aprovado', 'negado', 'recusado', 'expirado'] as const;
export type QrLoginStatus = (typeof QR_LOGIN_STATUSES)[number];

export const qrLoginStatusSchema = z.object({
  status: z.enum(QR_LOGIN_STATUSES),
  expiresAt: z.string(),
  /** Troque por sessão com `verifyOtp({ token_hash, type: 'magiclink' })`. Uso único. */
  tokenHash: z.string().optional(),
});
export type QrLoginStatusDto = z.infer<typeof qrLoginStatusSchema>;

/** Prefixo do parâmetro de `/start` que identifica um pedido de login (o convite e o vínculo não o usam). */
export const QR_LOGIN_START_PREFIX = 'login_';
