import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { INVITE_CODE_LENGTH, type InviteDto, type InviteStatus, type InviteSummaryDto } from '@nexus/shared';
import { ConflictError, ForbiddenError, InviteCodeCollisionError, NotFoundError } from './errors.js';
import type { AccountProvisioner, Clock, InviteRecord, InviteRepository, LinkCodeRepository } from './ports.js';
import { generateCode } from './telegram/link.js';

/** Convites ficam 7 dias por padrão; a config pode mudar (1 a 90 dias). */
export const INVITE_DEFAULT_TTL_DAYS = 7;
/** Quantos convites a lista devolve (os mais recentes). */
export const INVITE_LIST_LIMIT = 200;
const MAX_COLLISION_RETRIES = 3;
const DAY_MS = 24 * 60 * 60_000;

export function inviteStatus(record: InviteRecord, now: Date): InviteStatus {
  if (record.usedAt !== null) return 'usado';
  if (record.revokedAt !== null) return 'revogado';
  if (record.expiresAt.getTime() <= now.getTime()) return 'expirado';
  return 'ativo';
}

function inviteLink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=${code}`;
}

/** Link do Telegram que abre a escolha de conversa já com o convite escrito. */
export function inviteShareUrl(link: string): string {
  const text = 'Entre no Nexus, meu assistente de tarefas e lembretes:';
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}

export type InviteDeps = {
  invites: InviteRepository;
  accounts: Pick<AccountProvisioner, 'block'>;
  /** Telegram user ids dos administradores (`ADMIN_TELEGRAM_USER_IDS`). Vazio = ninguém administra. */
  adminTelegramIds: ReadonlySet<number>;
  botUsername: string | undefined;
  ttlDays?: number;
  clock: Clock;
  randomBytes?: (n: number) => Uint8Array;
};

/**
 * Convites: quem pode criar, listar e revogar é o administrador, e administrador é a conta cujo Telegram
 * VINCULADO (confirmado pelo código de vínculo) está na lista da configuração. A lista fica fora do banco
 * de propósito: não há coluna para escalar por engano, e perder o acesso é só editar o ambiente.
 */
export function makeInviteUseCases(deps: InviteDeps) {
  const randomBytes = deps.randomBytes ?? ((n: number) => nodeRandomBytes(n));
  const ttlMs = (deps.ttlDays ?? INVITE_DEFAULT_TTL_DAYS) * DAY_MS;

  const toDto = (record: InviteRecord, now: Date): InviteDto => ({
    code: record.code,
    link: inviteLink(deps.botUsername ?? '', record.code),
    status: inviteStatus(record, now),
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    usedAt: record.usedAt?.toISOString() ?? null,
    label: record.label ?? null,
  });

  async function requireAdmin(userId: string): Promise<void> {
    if (deps.adminTelegramIds.size === 0) throw new ForbiddenError();
    const telegramId = await deps.invites.telegramIdOf(userId);
    if (telegramId === null || !deps.adminTelegramIds.has(telegramId)) throw new ForbiddenError();
  }

  return {
    /** O chat (id do usuário do Telegram) é de um administrador? Só uma pré-checagem; `create` confere de novo. */
    isAdminChat(chatId: number): boolean {
      return deps.adminTelegramIds.has(chatId);
    },

    async isAdmin(userId: string): Promise<boolean> {
      try {
        await requireAdmin(userId);
        return true;
      } catch (error) {
        if (error instanceof ForbiddenError) return false;
        throw error;
      }
    },

    async create(userId: string, label?: string): Promise<InviteDto> {
      await requireAdmin(userId);
      const now = deps.clock.now();
      const expiresAt = new Date(now.getTime() + ttlMs);
      for (let attempt = 0; ; attempt++) {
        const code = generateCode(randomBytes, INVITE_CODE_LENGTH);
        try {
          await deps.invites.create(userId, code, now, expiresAt, label);
          return toDto({ code, createdBy: userId, createdAt: now, expiresAt, revokedAt: null, usedAt: null, label: label ?? null }, now);
        } catch (error) {
          if (!(error instanceof InviteCodeCollisionError) || attempt >= MAX_COLLISION_RETRIES) throw error;
        }
      }
    },

    async summary(userId: string): Promise<InviteSummaryDto> {
      await requireAdmin(userId);
      const now = deps.clock.now();
      const summary: InviteSummaryDto = { total: 0, ativos: 0, usados: 0, expirados: 0, revogados: 0 };
      for (const record of await deps.invites.list(INVITE_LIST_LIMIT)) {
        const status = inviteStatus(record, now);
        summary.total++;
        if (status === 'ativo') summary.ativos++;
        else if (status === 'usado') summary.usados++;
        else if (status === 'expirado') summary.expirados++;
        else summary.revogados++;
      }
      return summary;
    },

    /**
     * Apaga o convite. Se já foi usado, a pessoa perde o acesso na hora (conta bloqueada, Telegram
     * desvinculado; os dados ficam). Nunca alcança a própria conta nem a de outro administrador.
     */
    async remove(userId: string, code: string): Promise<void> {
      await requireAdmin(userId);
      const record = await deps.invites.find(code);
      if (record === null) throw new NotFoundError('convite');
      const guest = record.usedBy ?? null;
      if (guest !== null) {
        const guestTelegram = await deps.invites.telegramIdOf(guest);
        if (guest === userId || (guestTelegram !== null && deps.adminTelegramIds.has(guestTelegram))) {
          throw new ConflictError('convite_de_administrador');
        }
        await deps.accounts.block(guest);
      }
      await deps.invites.remove(code);
    },

    async list(userId: string): Promise<InviteDto[]> {
      await requireAdmin(userId);
      const now = deps.clock.now();
      return (await deps.invites.list(INVITE_LIST_LIMIT)).map((r) => toDto(r, now));
    },

    async revoke(userId: string, code: string): Promise<void> {
      await requireAdmin(userId);
      // Já usado, revogado ou inexistente: nada a revogar (404; não distingue o motivo).
      if (!(await deps.invites.revoke(code, deps.clock.now()))) throw new NotFoundError('convite');
    },
  };
}

export type AcceptInviteDeps = {
  invites: InviteRepository;
  accounts: AccountProvisioner;
  links: Pick<LinkCodeRepository, 'userForChat'>;
  clock: Clock;
};

export type AcceptInviteResult =
  | { status: 'criada'; userId: string }
  | { status: 'ja_vinculado' }
  | { status: 'invalido' };

/**
 * Aceita um convite: reserva o código (atômico: duas pessoas com o mesmo código, só uma entra), cria a
 * conta ligada ao Telegram e marca o convite como usado. Qualquer falha depois da reserva devolve o
 * código e desfaz a conta criada nesta tentativa, para o convidado poder tentar de novo. O resultado
 * `invalido` não diz se o código é desconhecido, vencido, usado ou revogado.
 */
export function makeAcceptInvite(deps: AcceptInviteDeps) {
  return async (code: string, chatId: number): Promise<AcceptInviteResult> => {
    // Quem já tem conta não gasta convite.
    if ((await deps.links.userForChat(chatId)) !== null) return { status: 'ja_vinculado' };

    const now = deps.clock.now();
    if (!(await deps.invites.claim(code, now))) return { status: 'invalido' };

    let created: { userId: string; created: boolean } | null = null;
    try {
      created = await deps.accounts.createForTelegram(chatId);
      await deps.accounts.linkChat(created.userId, chatId);
      await deps.invites.finish(code, created.userId, now);
      return { status: 'criada', userId: created.userId };
    } catch (error) {
      await deps.invites.release(code).catch(() => undefined);
      // Só apaga a conta que ESTA tentativa criou; uma conta anterior do mesmo Telegram nunca é apagada.
      if (created?.created === true) await deps.accounts.remove(created.userId).catch(() => undefined);
      if (error instanceof Error && error.name === 'ChatAlreadyLinkedError') return { status: 'ja_vinculado' };
      throw error;
    }
  };
}
