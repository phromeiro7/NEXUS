import { isLate, renderReminder, retryDelayMs } from '../domain/reminder-message.js';
import { ReminderLeaseError } from './errors.js';
import type {
  ClaimedReminder,
  Clock,
  ProfileRepository,
  ReminderQueue,
  TaskRepository,
  TelegramClient,
} from './ports.js';
import type { makeSyncReminders } from './sync-reminders.js';

const MAX_ATTEMPTS = 5;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

type LogFields = Record<string, string | number | boolean | null>;
export type RemindersLogger = {
  info(event: string, fields: LogFields): void;
  error(event: string, fields: LogFields): void;
};

export type RunRemindersDeps = {
  queue: ReminderQueue;
  /** Ausente = Telegram não configurado: só recupera e cancela, nunca reserva (Ruling 13). */
  telegram?: TelegramClient;
  tasks: TaskRepository;
  profiles: ProfileRepository;
  syncReminders: ReturnType<typeof makeSyncReminders>;
  clock: Clock;
  logger?: RemindersLogger;
};

export type RunRemindersResult = {
  sent: number;
  retried: number;
  failed: number;
  cancelled: number;
  recovered: number;
  paused: number;
  leaseLost: number;
  /** Devolvidos a pendente sem envio por falta de tempo na execução. */
  deferred: number;
};

const DEFAULT_BUDGET_MS = 25_000;

export function makeRunReminders(deps: RunRemindersDeps) {
  const { queue, telegram, tasks, profiles, syncReminders, clock, logger } = deps;

  return async (
    opts: { maxBatches?: number; batchSize?: number; budgetMs?: number } = {},
  ): Promise<RunRemindersResult> => {
    const maxBatches = opts.maxBatches ?? 5;
    const batchSize = opts.batchSize ?? 20;
    const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
    const startedAt = clock.now().getTime();
    const result: RunRemindersResult = {
      sent: 0,
      retried: 0,
      failed: 0,
      cancelled: 0,
      recovered: 0,
      paused: 0,
      leaseLost: 0,
      deferred: 0,
    };

    result.recovered = await queue.recoverStuck(clock.now());
    result.cancelled = await queue.cancelDead(clock.now());

    const pausedUsers = new Set<string>();

    /** Lease perdida é benigna (Ruling 17): registra só o código e segue. */
    const guarded = async (reminderId: string, work: () => Promise<void>): Promise<void> => {
      try {
        await work();
      } catch (err) {
        if (err instanceof ReminderLeaseError) {
          result.leaseLost += 1;
          logger?.info('reminder.lease_lost', { reminderId, code: err.code });
        } else {
          const name = err instanceof Error ? err.name : 'desconhecido';
          logger?.error('reminder.unexpected_error', { reminderId, errorName: name });
        }
      }
    };

    const changedSince = (r: ClaimedReminder, t: { dueDate: string | null; dueTime: string | null; fatal: boolean }) =>
      t.dueDate !== r.dueDate || t.dueTime !== r.dueTime || t.fatal !== r.fatal;

    const processOne = async (r: ClaimedReminder, rest: ClaimedReminder[], handled: Set<string>): Promise<void> => {
      const finish = (
        status: 'enviado' | 'pendente' | 'falhou' | 'cancelado',
        error: string | null,
        nextAttemptAt: Date | null,
      ) => queue.finish({ reminderId: r.reminderId, attempts: r.attempts, status, error, nextAttemptAt }, clock.now());

      /** Contrato 2: depois de qualquer desfecho, se a tarefa mudou desde a reserva, refaz os lembretes dela. */
      const resyncIfChanged = async (): Promise<void> => {
        const after = await tasks.get(r.userId, r.taskId);
        if (after !== null && after.status !== 'concluida' && after.status !== 'cancelada' && changedSince(r, after)) {
          await syncReminders(r.userId, after, await profiles.get(r.userId));
        }
      };

      if (r.attempts > MAX_ATTEMPTS) {
        await finish('falhou', 'tentativas_esgotadas', null);
        result.failed += 1;
        logger?.error('reminder.failed', { reminderId: r.reminderId, attempts: r.attempts, reason: 'tentativas_esgotadas' });
        await resyncIfChanged();
        return;
      }

      const task = await tasks.get(r.userId, r.taskId);
      if (task === null || task.status === 'concluida' || task.status === 'cancelada') {
        await finish('cancelado', 'tarefa_encerrada', null);
        result.cancelled += 1;
        return;
      }
      if (task.dueDate === null) {
        await finish('cancelado', 'sem_data', null);
        result.cancelled += 1;
        await syncReminders(r.userId, task, await profiles.get(r.userId));
        return;
      }
      if (changedSince(r, task)) {
        await finish('cancelado', 'remarcada', null);
        result.cancelled += 1;
        await syncReminders(r.userId, task, await profiles.get(r.userId));
        return;
      }

      const text = renderReminder({
        kind: r.kind,
        title: r.title,
        taskType: r.taskType,
        dueDate: r.dueDate,
        dueTime: r.dueTime,
        fatal: r.fatal,
        late: isLate(r.scheduledAt, clock.now()),
      });
      const sendStartedAt = clock.now().getTime();
      const sendResult = await telegram!.sendMessage(r.chatId, text);

      if (sendResult.ok) {
        try {
          await finish('enviado', null, null);
        } catch (err) {
          // A mensagem saiu mas o registro falhou: a recuperação pode reenviar (pelo menos uma vez).
          logger?.error('reminder.sent_unrecorded', {
            reminderId: r.reminderId,
            error: err instanceof ReminderLeaseError ? err.code : err instanceof Error ? err.name : 'desconhecido',
          });
          throw err;
        }
        result.sent += 1;
        logger?.info('reminder.sent', {
          reminderId: r.reminderId,
          attempts: r.attempts,
          durationMs: clock.now().getTime() - sendStartedAt,
        });
        await resyncIfChanged();
        return;
      }

      const error = sendResult.error;
      if (error.kind === 'transient') {
        const delay = retryDelayMs(r.attempts);
        if (delay === null) {
          await finish('falhou', 'tentativas_esgotadas', null);
          result.failed += 1;
          logger?.error('reminder.failed', { reminderId: r.reminderId, attempts: r.attempts, reason: 'tentativas_esgotadas' });
          await resyncIfChanged();
          return;
        }
        const waitMs = Math.max(delay, Math.min(error.retryAfterMs ?? 0, MAX_RETRY_AFTER_MS));
        await finish('pendente', 'transitorio', new Date(clock.now().getTime() + waitMs));
        result.retried += 1;
        logger?.info('reminder.retry', { reminderId: r.reminderId, attempts: r.attempts, waitMs });
        await resyncIfChanged();
        return;
      }

      await finish('falhou', error.reason, null);
      result.failed += 1;
      logger?.error('reminder.failed', { reminderId: r.reminderId, attempts: r.attempts, reason: error.reason });
      await resyncIfChanged();

      if (error.reason === 'bot_bloqueado' || error.reason === 'chat_inexistente') {
        if (!pausedUsers.has(r.userId)) {
          pausedUsers.add(r.userId);
          await queue.pauseChannel(r.userId);
          result.paused += 1;
          logger?.error('reminder.channel_paused', { userId: r.userId, reason: error.reason });
        }
        for (const other of rest) {
          if (other.userId !== r.userId || handled.has(other.reminderId)) continue;
          handled.add(other.reminderId);
          await guarded(other.reminderId, () =>
            queue.finish(
              {
                reminderId: other.reminderId,
                attempts: other.attempts,
                status: 'pendente',
                error: 'canal_pausado',
                nextAttemptAt: clock.now(),
              },
              clock.now(),
            ),
          );
        }
      }
    };

    if (telegram === undefined) {
      logger?.info('reminders.run', { ...result, durationMs: clock.now().getTime() - startedAt, telegram: false });
      return result;
    }

    const overBudget = () => clock.now().getTime() - startedAt > budgetMs;
    let outOfTime = false;

    for (let batch = 0; batch < maxBatches && !outOfTime; batch += 1) {
      if (overBudget()) break;
      const claimed = await queue.claimDue(clock.now(), batchSize);
      if (claimed.length === 0) break;
      const handled = new Set<string>();
      for (let i = 0; i < claimed.length; i += 1) {
        const r = claimed[i]!;
        if (handled.has(r.reminderId)) continue;
        if (outOfTime || overBudget()) {
          outOfTime = true;
          result.deferred += 1;
          logger?.info('reminder.deferred', { reminderId: r.reminderId, reason: 'orcamento_de_tempo' });
          await guarded(r.reminderId, () =>
            queue.finish(
              {
                reminderId: r.reminderId,
                attempts: r.attempts,
                status: 'pendente',
                error: 'orcamento_de_tempo',
                nextAttemptAt: clock.now(),
              },
              clock.now(),
            ),
          );
          continue;
        }
        await guarded(r.reminderId, () => processOne(r, claimed.slice(i + 1), handled));
      }
    }

    logger?.info('reminders.run', { ...result, durationMs: clock.now().getTime() - startedAt, telegram: true });
    return result;
  };
}
