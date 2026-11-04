import { z } from 'zod';

/** Corpo de `POST /auth/telegram`: o `initData` que o Telegram entrega ao Mini App, sem alteração. */
export const telegramAuthInputSchema = z.object({ initData: z.string().min(1).max(4096) }).strict();
export type TelegramAuthInput = z.infer<typeof telegramAuthInputSchema>;

/**
 * Resposta de `POST /auth/telegram`: o cliente troca `tokenHash` por uma sessão com
 * `verifyOtp({ token_hash, type: 'magiclink' })`. Uso único e de vida curta.
 */
export type TelegramAuthResultDto = { tokenHash: string };

/** Códigos de erro de `POST /auth/telegram`, para o cliente escolher a mensagem. */
export const TELEGRAM_AUTH_ERRORS = [
  'login_desabilitado',
  'assinatura_invalida',
  'sessao_expirada',
  'ja_utilizado',
  'telegram_nao_vinculado',
  'muitas_tentativas',
] as const;
export type TelegramAuthErrorCode = (typeof TELEGRAM_AUTH_ERRORS)[number];
