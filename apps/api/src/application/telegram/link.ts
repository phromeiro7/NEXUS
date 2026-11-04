import { randomBytes as nodeRandomBytes } from 'node:crypto';
import type { LinkCodeDto } from '@aj/shared';
import { LinkCodeCollisionError, TelegramNotConfiguredError } from '../errors.js';
import type { Clock, LinkCodeRepository } from '../ports.js';

/** Sem caracteres ambíguos (0/O, 1/I/L). 31 símbolos. */
export const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LINK_CODE_LENGTH = 8;
export const LINK_CODE_TTL_MS = 10 * 60_000;
/** Colisões de código: a nova tentativa usa SEMPRE um código novo (1 tentativa + até 3 repetições). */
const MAX_COLLISION_RETRIES = 3;
/** Maior múltiplo de 31 abaixo de 256: bytes >= 248 são descartados (sem viés de módulo). */
const ACCEPT_BELOW = Math.floor(256 / LINK_CODE_ALPHABET.length) * LINK_CODE_ALPHABET.length;
/** Proteção contra uma fonte de bytes quebrada que só devolve valores rejeitados. */
const MAX_ROUNDS = 64;

/** Código de vínculo por amostragem com rejeição sobre bytes aleatórios criptográficos. */
export function generateCode(randomBytes: (n: number) => Uint8Array, length: number = LINK_CODE_LENGTH): string {
  let code = '';
  for (let round = 0; round < MAX_ROUNDS && code.length < length; round++) {
    for (const byte of randomBytes(length - code.length)) {
      if (byte < ACCEPT_BELOW) code += LINK_CODE_ALPHABET[byte % LINK_CODE_ALPHABET.length];
      if (code.length === length) break;
    }
  }
  if (code.length !== length) throw new Error('Fonte de bytes aleatórios não produziu um código');
  return code;
}

export function makeLinkUseCases(deps: {
  links: LinkCodeRepository;
  botUsername: string | undefined;
  clock: Clock;
  randomBytes?: (n: number) => Uint8Array;
}) {
  const randomBytes = deps.randomBytes ?? ((n: number) => nodeRandomBytes(n));

  return {
    /** Gera um código de uso único (substitui os anteriores do usuário), válido por 10 minutos. */
    async createCode(userId: string): Promise<LinkCodeDto> {
      const botUsername = deps.botUsername;
      if (botUsername === undefined || botUsername === '') throw new TelegramNotConfiguredError();
      const expiresAt = new Date(deps.clock.now().getTime() + LINK_CODE_TTL_MS);
      for (let attempt = 0; ; attempt++) {
        const code = generateCode(randomBytes);
        try {
          await deps.links.create(userId, code, expiresAt);
          return {
            code,
            deepLink: `https://t.me/${botUsername}?start=${code}`,
            expiresAt: expiresAt.toISOString(),
          };
        } catch (error) {
          if (!(error instanceof LinkCodeCollisionError) || attempt >= MAX_COLLISION_RETRIES) throw error;
        }
      }
    },

    async unlink(userId: string): Promise<void> {
      await deps.links.unlink(userId);
    },
  };
}
