import type { IsoDate, TaskType } from '@nexus/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ReminderLeaseError } from '../application/errors.js';
import type { ClaimedReminder, ReminderQueue } from '../application/ports.js';
import type { ReminderKind } from '../domain/reminders.js';
import { toHourMinute } from './mappers.js';

type ClaimRow = {
  reminder_id: string;
  user_id: string;
  task_id: string;
  kind: ReminderKind;
  scheduled_at: string;
  attempts: number;
  title: string;
  task_type: TaskType;
  due_date: IsoDate;
  due_time: string | null;
  fatal: boolean;
  telegram_chat_id: number;
  timezone: string;
};

const LEASE_CODES = ['lembrete_inexistente', 'lembrete_reservado_por_outro', 'lembrete_em_estado_invalido'] as const;

/** Só as três perdas de reserva viram erro tipado; qualquer outra falha do banco é um erro comum. */
function leaseError(message: string): ReminderLeaseError | null {
  const code = LEASE_CODES.find((c) => message.includes(c));
  return code ? new ReminderLeaseError(code) : null;
}

function claimedFromRow(row: ClaimRow): ClaimedReminder {
  return {
    reminderId: row.reminder_id,
    userId: row.user_id,
    taskId: row.task_id,
    kind: row.kind,
    scheduledAt: new Date(row.scheduled_at),
    attempts: row.attempts,
    title: row.title,
    taskType: row.task_type,
    dueDate: row.due_date,
    dueTime: toHourMinute(row.due_time),
    fatal: row.fatal,
    chatId: Number(row.telegram_chat_id),
    timezone: row.timezone,
  };
}

export function createSupabaseReminderQueue(client: SupabaseClient): ReminderQueue {
  return {
    async claimDue(now, limit) {
      const { data, error } = await client.rpc('claim_due_reminders', { p_now: now.toISOString(), p_limit: limit });
      if (error) throw new Error(`Falha ao reservar lembretes: ${error.message}`);
      return ((data ?? []) as ClaimRow[]).map(claimedFromRow);
    },

    async cancelDead(now) {
      const { data, error } = await client.rpc('cancel_dead_reminders', { p_now: now.toISOString() });
      if (error) throw new Error(`Falha ao cancelar lembretes mortos: ${error.message}`);
      return (data as number | null) ?? 0;
    },

    async recoverStuck(now) {
      const { data, error } = await client.rpc('recover_stuck_reminders', { p_now: now.toISOString() });
      if (error) throw new Error(`Falha ao recuperar lembretes presos: ${error.message}`);
      return (data as number | null) ?? 0;
    },

    async finish(input, now) {
      const { error } = await client.rpc('finish_reminder', {
        p_id: input.reminderId,
        p_attempts: input.attempts,
        p_status: input.status,
        p_error: input.error,
        p_next_attempt_at: input.nextAttemptAt === null ? null : input.nextAttemptAt.toISOString(),
        p_now: now.toISOString(),
      });
      if (error) throw leaseError(error.message) ?? new Error(`Falha ao registrar resultado do lembrete: ${error.message}`);
    },

    async pauseChannel(userId) {
      const { error } = await client.from('profiles').update({ channel_paused: true }).eq('id', userId);
      if (error) throw new Error(`Falha ao pausar o canal: ${error.message}`);
    },
  };
}
