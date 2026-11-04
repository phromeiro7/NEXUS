import type { SupabaseClient } from '@supabase/supabase-js';
import { ChatAlreadyLinkedError } from '../application/errors.js';
import type { AccountProvisioner } from '../application/ports.js';

const UNIQUE_VIOLATION = '23505';
/** Domínio reservado (RFC 2606): nunca entrega e-mail. */
export const SYNTHETIC_EMAIL_DOMAIN = 'telegram.invalid';
const PAGE_SIZE = 200;
const MAX_PAGES = 50;

/** O e-mail interno de uma conta criada por convite. Nunca é mostrado nem recebe mensagem. */
export const syntheticEmail = (telegramUserId: number): string => `tg-${telegramUserId}@${SYNTHETIC_EMAIL_DOMAIN}`;

export const isSyntheticEmail = (email: string | undefined | null): boolean =>
  typeof email === 'string' && email.toLowerCase().endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`);

/**
 * Contas por convite. O Supabase Auth recusa usuário sem e-mail e sem telefone, então a conta recebe um
 * e-mail interno determinístico em domínio `.invalid`, já confirmado e SEM senha (só entra pelo
 * Telegram: o login gera um token de uso único com `admin.generateLink`, que não envia e-mail).
 * Se a conta desse Telegram já existe (ex.: depois de `/desvincular`), ela é reaproveitada.
 */
export function createSupabaseAccountProvisioner(client: SupabaseClient): AccountProvisioner {
  async function findByEmail(email: string): Promise<string | null> {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data, error } = await client.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
      if (error) throw new Error(`Falha ao procurar a conta: ${error.message}`);
      const hit = data.users.find((u) => u.email?.toLowerCase() === email);
      if (hit) return hit.id;
      if (data.users.length < PAGE_SIZE) return null;
    }
    return null;
  }

  return {
    async createForTelegram(telegramUserId) {
      const email = syntheticEmail(telegramUserId);
      const { data, error } = await client.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { origin: 'telegram' },
      });
      if (data?.user) return { userId: data.user.id, created: true };
      if (error?.code === 'email_exists') {
        const existing = await findByEmail(email);
        if (existing !== null) return { userId: existing, created: false };
      }
      throw new Error(`Falha ao criar a conta do convite: ${error?.code ?? 'desconhecido'}`);
    },

    async linkChat(userId, chatId) {
      const { error } = await client
        .from('profiles')
        .update({ telegram_chat_id: chatId, channel_paused: false })
        .eq('id', userId);
      if (error?.code === UNIQUE_VIOLATION) throw new ChatAlreadyLinkedError();
      if (error) throw new Error(`Falha ao vincular o Telegram: ${error.message}`);
    },

    async remove(userId) {
      const { error } = await client.auth.admin.deleteUser(userId);
      if (error) throw new Error(`Falha ao desfazer a conta do convite: ${error.message}`);
    },
  };
}
