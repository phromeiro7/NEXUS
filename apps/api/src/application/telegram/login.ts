import { TelegramAuthError } from '../errors.js';
import type { Clock, LinkCodeRepository, SessionIssuer, TelegramAuthReplayRepository } from '../ports.js';
import { verifyInitData } from '../../domain/telegram-init-data.js';
import type { RateLimiter } from './rate-limit.js';

export type TelegramLoginDeps = {
  /** Ausente = login pelo Telegram desligado ('login_desabilitado'). Nunca logar. */
  botToken?: string;
  /** Janela do `auth_date`, em segundos. */
  maxAgeSeconds: number;
  replays: TelegramAuthReplayRepository;
  links: Pick<LinkCodeRepository, 'userForChat'>;
  sessions: SessionIssuer;
  /** Por IP, antes de qualquer coisa. */
  ipLimiter: RateLimiter;
  /** Por usuário do Telegram, só depois de a assinatura valer (senão qualquer um gastaria a cota de outro). */
  userLimiter: RateLimiter;
  clock: Clock;
};

/**
 * Login do Mini App. Ordem, do mais barato ao mais caro: limite por IP, assinatura, vínculo, anti-reuso,
 * emissão da sessão. Só quem já tem o Telegram vinculado entra (a entrada de convidados é outro fluxo);
 * um `initData` de Telegram não vinculado NÃO é consumido, para a pessoa poder vincular e tentar de novo.
 * O `user_id` da sessão vem só do vínculo guardado no servidor, nunca do corpo da requisição.
 */
export function makeTelegramLogin(deps: TelegramLoginDeps) {
  return async (input: { initData: string; ip: string }): Promise<{ tokenHash: string }> => {
    if (deps.botToken === undefined || deps.botToken === '') throw new TelegramAuthError('login_desabilitado');

    const ipWait = deps.ipLimiter.hit(`ip:${input.ip}`);
    if (ipWait !== null) throw new TelegramAuthError('muitas_tentativas', ipWait);

    const now = deps.clock.now();
    const checked = verifyInitData(input.initData, deps.botToken, Math.floor(now.getTime() / 1000), deps.maxAgeSeconds);
    if (!checked.ok) {
      throw new TelegramAuthError(checked.reason === 'expirado' ? 'sessao_expirada' : 'assinatura_invalida');
    }

    const userWait = deps.userLimiter.hit(`tg:${checked.user.id}`);
    if (userWait !== null) throw new TelegramAuthError('muitas_tentativas', userWait);

    // Num chat privado o id do chat é o id do usuário do Telegram: é o vínculo que já existe.
    const userId = await deps.links.userForChat(checked.user.id);
    if (userId === null) throw new TelegramAuthError('telegram_nao_vinculado');

    if (!(await deps.replays.claim(checked.hash, now))) throw new TelegramAuthError('ja_utilizado');

    const session = await deps.sessions.issue(userId);
    // Conta sem como receber sessão: tratada como não vinculada (nada mais é revelado).
    if (session === null) throw new TelegramAuthError('telegram_nao_vinculado');
    return session;
  };
}
