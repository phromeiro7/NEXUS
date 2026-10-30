import type { SupabaseClient } from '@supabase/supabase-js';
import type { LinkCodeRepository } from '../application/ports.js';

type ConsumeRow = { status: 'ok' | 'invalido' | 'chat_em_uso'; user_id: string | null };

export function createSupabaseLinkRepository(client: SupabaseClient): LinkCodeRepository {
  return {
    async create(userId, code, expiresAt) {
      // Os códigos antigos saem primeiro: um usuário nunca tem mais de um código válido.
      const removed = await client.from('link_codes').delete().eq('user_id', userId);
      if (removed.error) throw new Error(`Falha ao apagar códigos de vínculo: ${removed.error.message}`);
      const { error } = await client
        .from('link_codes')
        .insert({ code, user_id: userId, expires_at: expiresAt.toISOString() });
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
      if (row.status === 'ok' && row.user_id !== null) return { status: 'ok', userId: row.user_id };
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
