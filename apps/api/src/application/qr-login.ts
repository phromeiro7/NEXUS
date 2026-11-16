import { createHash, randomBytes as nodeRandomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { QR_LOGIN_START_PREFIX, type QrLoginCreateResultDto, type QrLoginStatusDto } from '@nexus/shared';
import { browserLabel } from '../domain/browser-label.js';
import { NotFoundError, TelegramAuthError } from './errors.js';
import type { Clock, ProfileRepository, QrLoginRepository, SessionIssuer } from './ports.js';
import type { RateLimiter } from './telegram/rate-limit.js';

/** O código vale poucos minutos: o QR está na tela de quem está sentado ali. */
export const QR_LOGIN_TTL_MS = 3 * 60_000;
const NONCE_BYTES = 20; // 160 bits
const POLL_BYTES = 32; // 256 bits
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O que o Telegram aceita em `start`, sem o prefixo. */
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
/** Só se confia no `X-Poll-Secret` com o formato que a API gera (43 caracteres base64url). */
const POLL_SECRET_RE = /^[A-Za-z0-9_-]{16,128}$/;

const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

export type QrLoginDeps = {
  requests: QrLoginRepository;
  sessions: SessionIssuer;
  /** Ausente = login por QR desligado ('login_desabilitado'). */
  botUsername: string | undefined;
  /** Para a hora local da pergunta do bot. */
  profiles: Pick<ProfileRepository, 'get'>;
  /** Por IP, na criação de pedidos. */
  ipLimiter: RateLimiter;
  /** Por pedido, nas consultas do navegador. */
  pollLimiter: RateLimiter;
  clock: Clock;
  ttlMs?: number;
  randomBytes?: (n: number) => Uint8Array;
  newId?: () => string;
};

export type QrStartResult =
  | { kind: 'perguntar'; requestId: string; label: string; time: string }
  | { kind: 'recusado' }
  | { kind: 'invalido' };

export type QrDecision = 'aprovado' | 'negado' | 'expirado';

function clockIn(date: Date, timeZone: string): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  try {
    return fmt(timeZone);
  } catch {
    return fmt('America/Sao_Paulo');
  }
}

/**
 * Login do painel por QR code. O navegador cria um pedido e guarda o `pollSecret` só na memória; o QR leva
 * `login_<nonce>` ao bot; a pessoa confirma no Telegram; só o navegador com o `pollSecret` recebe, uma vez,
 * o token que `verifyOtp` troca por sessão. Os segredos ficam no banco apenas como hash, e o `id` público não
 * revela nenhum deles. Tudo que decide é um UPDATE atômico no repositório.
 */
export function makeQrLogin(deps: QrLoginDeps) {
  const randomBytes = deps.randomBytes ?? ((n: number) => nodeRandomBytes(n));
  const newId = deps.newId ?? randomUUID;
  const ttlMs = deps.ttlMs ?? QR_LOGIN_TTL_MS;
  const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

  return {
    async create(input: { ip: string; userAgent: string | undefined }): Promise<QrLoginCreateResultDto> {
      if (deps.botUsername === undefined) throw new TelegramAuthError('login_desabilitado');
      const wait = deps.ipLimiter.hit(`qr:${input.ip}`);
      if (wait !== null) throw new TelegramAuthError('muitas_tentativas', wait);
      const now = deps.clock.now();
      const nonce = b64url(randomBytes(NONCE_BYTES));
      const pollSecret = b64url(randomBytes(POLL_BYTES));
      const id = newId();
      const expiresAt = new Date(now.getTime() + ttlMs);
      await deps.requests.create({
        id,
        nonceHash: sha256Hex(nonce),
        pollHash: sha256Hex(pollSecret),
        clientLabel: browserLabel(input.userAgent),
        createdAt: now,
        expiresAt,
      });
      return {
        id,
        pollSecret,
        deepLink: `https://t.me/${deps.botUsername}?start=${QR_LOGIN_START_PREFIX}${nonce}`,
        expiresAt: expiresAt.toISOString(),
      };
    },

    /**
     * Consulta do navegador. Id inexistente e segredo errado respondem igual (404). Um pedido já recolhido
     * não entrega o token de novo ('ja_utilizado').
     */
    async status(input: { id: string; pollSecret: string | undefined }): Promise<QrLoginStatusDto> {
      if (deps.botUsername === undefined) throw new TelegramAuthError('login_desabilitado');
      if (!UUID_RE.test(input.id) || input.pollSecret === undefined || !POLL_SECRET_RE.test(input.pollSecret)) {
        throw new NotFoundError('login');
      }
      const wait = deps.pollLimiter.hit(`qr-poll:${input.id}`);
      if (wait !== null) throw new TelegramAuthError('muitas_tentativas', wait);

      const now = deps.clock.now();
      const record = await deps.requests.get(input.id);
      const pollHash = sha256Hex(input.pollSecret);
      if (
        record === null ||
        !timingSafeEqual(Buffer.from(record.pollHash, 'hex'), Buffer.from(pollHash, 'hex'))
      ) {
        throw new NotFoundError('login');
      }
      const expiresAt = record.expiresAt.toISOString();
      if (record.status === 'consumido') throw new TelegramAuthError('ja_utilizado');
      if (record.expiresAt.getTime() <= now.getTime()) return { status: 'expirado', expiresAt };
      if (record.status !== 'aprovado') return { status: record.status, expiresAt };

      // Aprovado: só uma consulta ganha o usuário. Quem perde já não pode receber o token.
      const userId = await deps.requests.consume(record.id, pollHash, now);
      if (userId === null) throw new TelegramAuthError('ja_utilizado');
      let session: { tokenHash: string } | null;
      try {
        session = await deps.sessions.issue(userId);
      } catch (error) {
        await deps.requests.release(record.id);
        throw error;
      }
      if (session === null) {
        // Conta sem como receber sessão: nada é revelado além de "sem acesso".
        await deps.requests.release(record.id);
        return { status: 'recusado', expiresAt };
      }
      return { status: 'aprovado', expiresAt, tokenHash: session.tokenHash };
    },

    /** O bot recebeu `/start login_<nonce>`; `userId` é o dono do chat, ou `null` se nenhum. */
    async start(input: { nonce: string; chatId: number; userId: string | null }): Promise<QrStartResult> {
      if (!NONCE_RE.test(input.nonce)) return { kind: 'invalido' };
      const now = deps.clock.now();
      const opened = await deps.requests.open(sha256Hex(input.nonce), input.chatId, input.userId, now);
      if (opened === null) return { kind: 'invalido' };
      if (opened.outcome === 'recusado' || input.userId === null) return { kind: 'recusado' };
      let timeZone = 'America/Sao_Paulo';
      try {
        timeZone = (await deps.profiles.get(input.userId)).timezone;
      } catch {
        // sem perfil legível: cai no fuso padrão, a pergunta continua valendo
      }
      return { kind: 'perguntar', requestId: opened.id, label: opened.clientLabel, time: clockIn(opened.createdAt, timeZone) };
    },

    /** A pessoa tocou em Confirmar ou "Não fui eu". `expirado` = já decidido, de outro chat ou vencido. */
    async decide(input: { requestId: string; chatId: number; userId: string; approve: boolean }): Promise<QrDecision> {
      if (!UUID_RE.test(input.requestId)) return 'expirado';
      const result = await deps.requests.decide(input.requestId, input.chatId, input.userId, input.approve, deps.clock.now());
      return result ?? 'expirado';
    },

    purgeExpired: (now: Date) => deps.requests.purgeExpired(now),
  };
}

export type QrLoginUseCases = ReturnType<typeof makeQrLogin>;
