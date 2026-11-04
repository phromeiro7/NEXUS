import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionIssuer, TelegramAuthReplayRepository } from '../application/ports.js';

const UNIQUE_VIOLATION = '23505';

export function createSupabaseTelegramAuthRepository(client: SupabaseClient): TelegramAuthReplayRepository {
  return {
    async claim(hash, now) {
      const { error } = await client.from('telegram_auth_replays').insert({ hash, seen_at: now.toISOString() });
      if (error?.code === UNIQUE_VIOLATION) return false;
      if (error) throw new Error(`Falha ao registrar o initData: ${error.message}`);
      return true;
    },
    async purgeExpired(now) {
      const { data, error } = await client.rpc('purge_telegram_auth_replays', { p_now: now.toISOString() });
      if (error) throw new Error(`Falha ao limpar registros do login pelo Telegram: ${error.message}`);
      return (data as number | null) ?? 0;
    },
  };
}

/**
 * Sessão pelo padrão do Supabase: `admin.generateLink` gera o token de um link mágico para o e-mail da
 * conta SEM enviar e-mail algum (só devolve o token); o cliente o troca por sessão com `verifyOtp`. O token
 * vale uma vez e por pouco tempo. Nada é registrado.
 */
export function createSupabaseSessionIssuer(client: SupabaseClient): SessionIssuer {
  return {
    async issue(userId) {
      const found = await client.auth.admin.getUserById(userId);
      const email = found.data.user?.email;
      if (found.error || !email) return null;
      const { data, error } = await client.auth.admin.generateLink({ type: 'magiclink', email });
      const tokenHash = data?.properties?.hashed_token;
      if (error || !tokenHash) throw new Error('Falha ao gerar a sessão do Telegram');
      return { tokenHash };
    },
  };
}
