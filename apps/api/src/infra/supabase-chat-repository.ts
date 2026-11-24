import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatRepository, ChatRole } from '../application/ports.js';

/** Histórico de conversa é efêmero: cada mensagem expira em 24 horas. */
const MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;

/** Histórico curto da conversa com o assistente, por usuário e canal. */
export function createSupabaseChatRepository(client: SupabaseClient): ChatRepository {
  return {
    async append(userId, channel, role, content, now) {
      const { error } = await client.from('chat_messages').insert({
        user_id: userId,
        channel,
        role,
        content,
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + MESSAGE_TTL_MS).toISOString(),
      });
      if (error) throw new Error(`Falha ao gravar mensagem: ${error.message}`);
    },

    async recent(userId, channel, limit, now) {
      // Empate de `created_at`: 'assistant' < 'user' em ordem crescente, então na lista
      // decrescente a resposta vem antes da pergunta e, ao inverter, a pergunta vem primeiro.
      const { data, error } = await client
        .from('chat_messages')
        .select('role, content')
        .eq('user_id', userId)
        .eq('channel', channel)
        .gt('expires_at', now.toISOString())
        .order('created_at', { ascending: false })
        .order('role', { ascending: true })
        .limit(limit);
      if (error) throw new Error(`Falha ao ler mensagens: ${error.message}`);
      return (data ?? []).reverse().map((row) => ({ role: row.role as ChatRole, content: row.content as string }));
    },
  };
}
