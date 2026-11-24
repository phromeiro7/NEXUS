import { createHash, randomBytes as nodeRandomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { QR_LOGIN_START_PREFIX, type QrLoginCreateResultDto, type QrLoginStatusDto } from '@nexus/shared';
import { browserLabel } from '../domain/browser-label.js';
import { NotFoundError, TelegramAuthError } from './errors.js';
import type { Clock, ProfileRepository, QrLoginRepository, SessionIssuer } from './ports.js';
import type { RateLimiter } from './telegram/rate-limit.js';

/** O código vale poucos minutos: o QR está na tela de quem está sentado ali. */
export const QR_LOGIN_TTL_MS = 3 * 60_000;
const NONCE_BYTES = 20; // 160 bits
const POLL_SECRET_BYTES = 32; // 256 bits
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O que o Telegram aceita em `start`, sem o prefixo. */
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
/** Só se confia no `X-Poll-Secret` com o formato que a API gera (43 caracteres base64url). */
const POLL_SECRET_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
/** Fuso usado quando o perfil não pode ser lido ou guarda um fuso inválido. */
const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

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

/** Hora local `HH:mm` de `date` no fuso dado; um fuso inválido cai no padrão em vez de lançar. */
function formatLocalTime(date: Date, timeZone: string): string {
  const formatIn = (zone: string) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  try {
    return formatIn(timeZone);
  } catch {
    return formatIn(DEFAULT_TIME_ZONE);
  }
}

/**
 * Login do painel por QR code. O navegador cria um pedido e guarda o `pollSecret` só na memória; o QR leva
 * `login_<nonce>` ao bot; a pessoa confirma no Telegram; só o navegador com o `pollSecret` recebe, uma vez,
 * o token que `verifyOtp` troca por sessão. Os segredos ficam no banco apenas como hash, e o `id` público não
 * revela nenhum deles. Tudo que decide é um UPDATE atômico no repositório.
 */
export function makeQrLogin(deps: QrLoginDeps) {
  const randomBytes = deps.randomBytes ?? ((byteCount: number) => nodeRandomBytes(byteCount));
  const newId = deps.newId ?? randomUUID;
  const ttlMs = deps.ttlMs ?? QR_LOGIN_TTL_MS;
  const toBase64Url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

  return {
    /** O navegador pede um QR: devolve o deep link do bot e o `pollSecret`, que só ele conhece. Limitado por IP. */
    async create(input: { ip: string; userAgent: string | undefined }): Promise<QrLoginCreateResultDto> {
      if (deps.botUsername === undefined) throw new TelegramAuthError('login_desabilitado');
      const retryAfterSeconds = deps.ipLimiter.hit(`qr:${input.ip}`);
      if (retryAfterSeconds !== null) throw new TelegramAuthError('muitas_tentativas', retryAfterSeconds);
      const now = deps.clock.now();
      const nonce = toBase64Url(randomBytes(NONCE_BYTES));
      const pollSecret = toBase64Url(randomBytes(POLL_SECRET_BYTES));
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
      // Formato inválido responde como pedido inexistente, antes de gastar o limite ou consultar o banco.
      if (!UUID_PATTERN.test(input.id) || input.pollSecret === undefined || !POLL_SECRET_PATTERN.test(input.pollSecret)) {
        throw new NotFoundError('login');
      }
      const retryAfterSeconds = deps.pollLimiter.hit(`qr-poll:${input.id}`);
      if (retryAfterSeconds !== null) throw new TelegramAuthError('muitas_tentativas', retryAfterSeconds);

      const now = deps.clock.now();
      const record = await deps.requests.get(input.id);
      const pollHash = sha256Hex(input.pollSecret);
      // Comparação em tempo constante: não vaza, pelo tempo de resposta, quanto do segredo acertou.
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
      if (!NONCE_PATTERN.test(input.nonce)) return { kind: 'invalido' };
      const now = deps.clock.now();
      const opened = await deps.requests.open(sha256Hex(input.nonce), input.chatId, input.userId, now);
      if (opened === null) return { kind: 'invalido' };
      if (opened.outcome === 'recusado' || input.userId === null) return { kind: 'recusado' };
      let timeZone = DEFAULT_TIME_ZONE;
      try {
        timeZone = (await deps.profiles.get(input.userId)).timezone;
      } catch {
        // sem perfil legível: cai no fuso padrão, a pergunta continua valendo
      }
      return { kind: 'perguntar', requestId: opened.id, label: opened.clientLabel, time: formatLocalTime(opened.createdAt, timeZone) };
    },

    /** A pessoa tocou em Confirmar ou "Não fui eu". `expirado` = já decidido, de outro chat ou vencido. */
    async decide(input: { requestId: string; chatId: number; userId: string; approve: boolean }): Promise<QrDecision> {
      if (!UUID_PATTERN.test(input.requestId)) return 'expirado';
      const result = await deps.requests.decide(input.requestId, input.chatId, input.userId, input.approve, deps.clock.now());
      return result ?? 'expirado';
    },

    /** Limpeza periódica (agendador) dos pedidos vencidos. */
    purgeExpired: (now: Date) => deps.requests.purgeExpired(now),
  };
}

export type QrLoginUseCases = ReturnType<typeof makeQrLogin>;
