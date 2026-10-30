import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConfirmationRepository } from '../application/ports.js';

type Row = { task_id: string; tasks: { deleted_at: string | null } | { deleted_at: string | null }[] | null };

export function createSupabaseConfirmationRepository(client: SupabaseClient): ConfirmationRepository {
  return {
    async record(chatId, messageId, taskIds) {
      if (taskIds.length === 0) return;
      const { error } = await client.from('task_confirmations').upsert(
        taskIds.map((taskId) => ({ channel: 'telegram', chat_id: chatId, message_id: messageId, task_id: taskId })),
        { onConflict: 'channel,chat_id,message_id,task_id', ignoreDuplicates: true },
      );
      if (error) throw new Error(`Falha ao gravar confirmação: ${error.message}`);
    },

    async tasksFor(userId, chatId, messageId) {
      // `!inner` + filtro em `tasks.user_id`: tarefa de outro usuário nunca entra no resultado.
      const { data, error } = await client
        .from('task_confirmations')
        .select('task_id, tasks!inner(deleted_at)')
        .eq('channel', 'telegram')
        .eq('chat_id', chatId)
        .eq('message_id', messageId)
        .eq('tasks.user_id', userId);
      if (error) throw new Error(`Falha ao ler confirmação: ${error.message}`);
      const alive: string[] = [];
      let deletedCount = 0;
      for (const row of (data ?? []) as unknown as Row[]) {
        const task = Array.isArray(row.tasks) ? row.tasks[0] : row.tasks;
        if (task?.deleted_at === null) alive.push(row.task_id);
        else deletedCount += 1;
      }
      return { alive: alive.sort(), deletedCount };
    },
  };
}
