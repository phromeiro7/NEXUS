import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReminderRepository } from '../application/ports.js';

export function createSupabaseReminderRepository(client: SupabaseClient): ReminderRepository {
  return {
    async replacePending(userId, taskId, drafts) {
      const { error } = await client.rpc('replace_pending_reminders', {
        p_user_id: userId,
        p_task_id: taskId,
        p_drafts: drafts.map((d) => ({ kind: d.kind, scheduled_at: d.scheduledAt.toISOString() })),
      });
      if (error) throw new Error(`Falha ao substituir lembretes: ${error.message}`);
    },
  };
}
