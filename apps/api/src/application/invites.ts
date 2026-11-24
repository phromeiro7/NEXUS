import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { INVITE_CODE_LENGTH, type InviteDto, type InviteStatus, type InviteSummaryDto } from '@nexus/shared';
import { ConflictError, ForbiddenError, InviteCodeCollisionError, NotFoundError } from './errors.js';
import type { AccountProvisioner, Clock, InviteRecord, InviteRepository, LinkCodeRepository } from './ports.js';
import { generateCode } from './telegram/link.js';

/** Convites ficam 7 dias por padrão; a config pode mudar (1 a 90 dias). */
export const INVITE_DEFAULT_TTL_DAYS = 7;
/** Quantos convites a lista devolve (os mais recentes). */
export const INVITE_LIST_LIMIT = 200;
/** Novas tentativas quando o código sorteado já existe (colisão rara, mas possível). */
const MAX_COLLISION_RETRIES = 3;
const MS_PER_DAY = 24 * 60 * 60_000;
const INVITE_SHARE_TEXT = 'Entre no Nexus, meu assistente de tarefas e lembretes:';

/** Estado do convite calculado na hora: uso e revogação valem mais que o vencimento. */
export function inviteStatus(record: InviteRecord, now: Date): InviteStatus {
  if (record.usedAt !== null) return 'usado';
  if (record.revokedAt !== null) return 'revogado';
  if (record.expiresAt.getTime() <= now.getTime()) return 'expirado';
  return 'ativo';
}

/** Deep link do bot que já leva o código do convite no `/start`. */
function inviteLink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=${code}`;
}

/** Link do Telegram que abre a escolha de conversa já com o convite escrito. */
export function inviteShareUrl(link: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(INVITE_SHARE_TEXT)}`;
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
  const randomBytes = deps.randomBytes ?? ((byteCount: number) => nodeRandomBytes(byteCount));
  const ttlMs = (deps.ttlDays ?? INVITE_DEFAULT_TTL_DAYS) * MS_PER_DAY;

  const toInviteDto = (record: InviteRecord, now: Date): InviteDto => ({
    code: record.code,
    link: inviteLink(deps.botUsername ?? '', record.code),
    status: inviteStatus(record, now),
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    usedAt: record.usedAt?.toISOString() ?? null,
    label: record.label ?? null,
  });

  /** Lança `ForbiddenError` se a conta não tem Telegram vinculado ou se ele não está na lista de administradores. */
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

    /** Versão booleana de `requireAdmin`, para o painel decidir o que mostrar. */
    async isAdmin(userId: string): Promise<boolean> {
      try {
        await requireAdmin(userId);
        return true;
      } catch (error) {
        if (error instanceof ForbiddenError) return false;
        throw error;
      }
    },

    /** Cria um convite com código novo; numa colisão sorteia outro, até `MAX_COLLISION_RETRIES` vezes. */
    async create(userId: string, label?: string): Promise<InviteDto> {
      await requireAdmin(userId);
      const now = deps.clock.now();
      const expiresAt = new Date(now.getTime() + ttlMs);
      for (let attempt = 0; ; attempt++) {
        const code = generateCode(randomBytes, INVITE_CODE_LENGTH);
        try {
          await deps.invites.create(userId, code, now, expiresAt, label);
          return toInviteDto({ code, createdBy: userId, createdAt: now, expiresAt, revokedAt: null, usedAt: null, label: label ?? null }, now);
        } catch (error) {
          if (!(error instanceof InviteCodeCollisionError) || attempt >= MAX_COLLISION_RETRIES) throw error;
        }
      }
    },

    /** Contagem por estado dos convites mais recentes (até `INVITE_LIST_LIMIT`). */
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
      const guestUserId = record.usedBy ?? null;
      if (guestUserId !== null) {
        const guestTelegramId = await deps.invites.telegramIdOf(guestUserId);
        const guestIsAdmin = guestTelegramId !== null && deps.adminTelegramIds.has(guestTelegramId);
        if (guestUserId === userId || guestIsAdmin) throw new ConflictError('convite_de_administrador');
        await deps.accounts.block(guestUserId);
      }
      await deps.invites.remove(code);
    },

    /** Os convites mais recentes, com estado e link prontos para o painel. */
    async list(userId: string): Promise<InviteDto[]> {
      await requireAdmin(userId);
      const now = deps.clock.now();
      return (await deps.invites.list(INVITE_LIST_LIMIT)).map((record) => toInviteDto(record, now));
    },

    /** Invalida um convite ainda não usado; a conta de quem já o usou não é afetada (para isso, `remove`). */
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

    let account: { userId: string; created: boolean } | null = null;
    try {
      account = await deps.accounts.createForTelegram(chatId);
      await deps.accounts.linkChat(account.userId, chatId);
      await deps.invites.finish(code, account.userId, now);
      return { status: 'criada', userId: account.userId };
    } catch (error) {
      // Desfaz best-effort: falhas da limpeza são engolidas para o erro original subir.
      await deps.invites.release(code).catch(() => undefined);
      // Só apaga a conta que ESTA tentativa criou; uma conta anterior do mesmo Telegram nunca é apagada.
      if (account?.created === true) await deps.accounts.remove(account.userId).catch(() => undefined);
      if (error instanceof Error && error.name === 'ChatAlreadyLinkedError') return { status: 'ja_vinculado' };
      throw error;
    }
  };
}
