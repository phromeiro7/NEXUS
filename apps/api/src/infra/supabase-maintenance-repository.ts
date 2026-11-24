import type { SupabaseClient } from '@supabase/supabase-js';
import type { MaintenanceRepository } from '../application/ports.js';

/** Limpezas periódicas do agendador; cada uma é uma RPC que devolve quantas linhas afetou. */
export function createSupabaseMaintenanceRepository(client: SupabaseClient): MaintenanceRepository {
  async function runPurge(functionName: string, now: Date, actionDescription: string): Promise<number> {
    const { data, error } = await client.rpc(functionName, { p_now: now.toISOString() });
    if (error) throw new Error(`Falha ao ${actionDescription}: ${error.message}`);
    return (data as number | null) ?? 0;
  }

  return {
    purgeExpiredChatMessages: (now) => runPurge('purge_expired_chat_messages', now, 'limpar mensagens expiradas'),
    purgeExpiredLinkCodes: (now) => runPurge('purge_expired_link_codes', now, 'limpar códigos de vínculo expirados'),
    purgeOldModelCalls: (now) => runPurge('purge_old_model_calls', now, 'limpar chamadas antigas ao modelo'),

    async recoverStuckEvents(now) {
      const { data, error } = await client.rpc('recover_stuck_events', { p_now: now.toISOString() });
      if (error) throw new Error(`Falha ao recuperar eventos presos: ${error.message}`);
      const row = (data as Array<{ recovered: number; failed: number }> | null)?.[0];
      return { recovered: row?.recovered ?? 0, failed: row?.failed ?? 0 };
    },
  };
}
