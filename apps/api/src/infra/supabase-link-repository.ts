import type { SupabaseClient } from '@supabase/supabase-js';
import { LinkCodeCollisionError } from '../application/errors.js';
import type { LinkCodeRepository } from '../application/ports.js';
import { maskEmail } from '../application/telegram/mask-email.js';
import { isSyntheticEmail } from './supabase-account-provisioner.js';

const UNIQUE_VIOLATION = '23505';

type ConsumeRow = { status: 'ok' | 'invalido' | 'chat_em_uso'; user_id: string | null };

export function createSupabaseLinkRepository(client: SupabaseClient): LinkCodeRepository {
  /**
   * E-mail mascarado da conta, só para a confirmação do vínculo. Qualquer falha (ou ausência de e-mail)
   * vira `null`: o vínculo já foi feito e o aviso cai no texto sem identificação. Nada é registrado
   * (nem o e-mail, nem o erro).
   */
  async function accountHintFor(userId: string): Promise<string | null> {
    try {
      const { data, error } = await client.auth.admin.getUserById(userId);
      // Conta criada por convite não tem e-mail de verdade: não há o que mostrar.
      if (error || !data.user?.email || isSyntheticEmail(data.user.email)) return null;
      return maskEmail(data.user.email);
    } catch {
      return null;
    }
  }

  return {
    async create(userId, code, expiresAt) {
      // Os códigos antigos saem primeiro: um usuário nunca tem mais de um código válido.
      const removed = await client.from('link_codes').delete().eq('user_id', userId);
      if (removed.error) throw new Error(`Falha ao apagar códigos de vínculo: ${removed.error.message}`);
      const { error } = await client
        .from('link_codes')
        .insert({ code, user_id: userId, expires_at: expiresAt.toISOString() });
      // A chave primária é o próprio código: duas pessoas sorteando o mesmo valor colidem aqui.
      if (error?.code === UNIQUE_VIOLATION) throw new LinkCodeCollisionError();
      if (error) throw new Error(`Falha ao gravar código de vínculo: ${error.message}`);
    },

    async consume(code, chatId, now) {
      const { data, error } = await client.rpc('consume_link_code', {
        p_code: code,
        p_chat_id: chatId,
        p_now: now.toISOString(),
      });
      if (error) throw new Error(`Falha ao consumir código de vínculo: ${error.message}`);
      const row = (data as ConsumeRow[] | null)?.[0];
      if (!row) throw new Error('Falha ao consumir código de vínculo: resposta vazia');
      if (row.status === 'ok' && row.user_id !== null) {
        return { status: 'ok', userId: row.user_id, accountHint: await accountHintFor(row.user_id) };
      }
      if (row.status === 'chat_em_uso') return { status: 'chat_em_uso' };
      if (row.status === 'invalido') return { status: 'invalido' };
      throw new Error('Falha ao consumir código de vínculo: resposta inesperada');
    },

    async unlink(userId) {
      const { error } = await client.from('profiles').update({ telegram_chat_id: null }).eq('id', userId);
      if (error) throw new Error(`Falha ao desvincular o Telegram: ${error.message}`);
    },

    async userForChat(chatId) {
      const { data, error } = await client.from('profiles').select('id').eq('telegram_chat_id', chatId).maybeSingle();
      if (error) throw new Error(`Falha ao buscar o dono do chat: ${error.message}`);
      return data ? (data.id as string) : null;
    },
  };
}
