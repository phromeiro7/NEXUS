import type { SupabaseClient } from '@supabase/supabase-js';
import type { MaintenanceRepository } from '../application/ports.js';

export function createSupabaseMaintenanceRepository(client: SupabaseClient): MaintenanceRepository {
  async function count(fn: string, now: Date, what: string): Promise<number> {
    const { data, error } = await client.rpc(fn, { p_now: now.toISOString() });
    if (error) throw new Error(`Falha ao ${what}: ${error.message}`);
    return (data as number | null) ?? 0;
  }

  return {
    purgeExpiredChatMessages: (now) => count('purge_expired_chat_messages', now, 'limpar mensagens expiradas'),
    purgeExpiredLinkCodes: (now) => count('purge_expired_link_codes', now, 'limpar códigos de vínculo expirados'),
    purgeOldModelCalls: (now) => count('purge_old_model_calls', now, 'limpar chamadas antigas ao modelo'),

    async recoverStuckEvents(now) {
      const { data, error } = await client.rpc('recover_stuck_events', { p_now: now.toISOString() });
      if (error) throw new Error(`Falha ao recuperar eventos presos: ${error.message}`);
      const row = (data as Array<{ recovered: number; failed: number }> | null)?.[0];
      return { recovered: row?.recovered ?? 0, failed: row?.failed ?? 0 };
    },
  };
}
