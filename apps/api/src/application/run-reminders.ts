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

/** Acima disso o lembrete desiste de vez (`tentativas_esgotadas`), mesmo sem erro definitivo. */
const MAX_ATTEMPTS = 5;
/** Teto para o `retry_after` pedido pelo Telegram: nunca adia um lembrete mais de um dia. */
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_BATCHES = 5;
const DEFAULT_BATCH_SIZE = 20;

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

/** Tempo máximo de uma execução; o que sobrar volta a `pendente` para a próxima passada. */
const DEFAULT_BUDGET_MS = 25_000;

/** Erros cujo chat não recebe mais nada: o canal do usuário é pausado até ele voltar a falar com o bot. */
const CHANNEL_BLOCKING_REASONS = new Set(['bot_bloqueado', 'chat_inexistente']);

type ReminderOutcome = 'enviado' | 'pendente' | 'falhou' | 'cancelado';
type ReminderRelevantFields = { dueDate: string | null; dueTime: string | null; fatal: boolean };

const errorNameOf = (error: unknown): string => (error instanceof Error ? error.name : 'desconhecido');

const isClosedTask = (task: { status: string }): boolean => task.status === 'concluida' || task.status === 'cancelada';

/** A tarefa mudou (data, hora ou fatal) desde que o lembrete foi reservado? Então ele está obsoleto. */
const taskChangedSinceClaim = (reminder: ClaimedReminder, task: ReminderRelevantFields): boolean =>
  task.dueDate !== reminder.dueDate || task.dueTime !== reminder.dueTime || task.fatal !== reminder.fatal;

/**
 * Uma passada de envio de lembretes: recupera os presos, cancela os mortos e envia os vencidos em lotes,
 * dentro do orçamento de tempo. Cada lembrete é isolado: a falha de um nunca interrompe os demais.
 */
export function makeRunReminders(deps: RunRemindersDeps) {
  const { queue, telegram, tasks, profiles, syncReminders, clock, logger } = deps;

  return async (
    options: { maxBatches?: number; batchSize?: number; budgetMs?: number } = {},
  ): Promise<RunRemindersResult> => {
    const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES;
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
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

    // Cada usuário é pausado uma vez só por execução, mesmo com vários lembretes falhando.
    const pausedUserIds = new Set<string>();

    /** Lease perdida é benigna (Ruling 17): registra só o código e segue. */
    const runIgnoringLeaseLoss = async (reminderId: string, work: () => Promise<void>): Promise<void> => {
      try {
        await work();
      } catch (error) {
        if (error instanceof ReminderLeaseError) {
          result.leaseLost += 1;
          logger?.info('reminder.lease_lost', { reminderId, code: error.code });
        } else {
          logger?.error('reminder.unexpected_error', { reminderId, errorName: errorNameOf(error) });
        }
      }
    };

    /** Devolve o lembrete a `pendente` para já, sem gastar tentativa de envio. */
    const returnToPending = (reminder: ClaimedReminder, reason: string): Promise<void> =>
      queue.finish(
        {
          reminderId: reminder.reminderId,
          attempts: reminder.attempts,
          status: 'pendente',
          error: reason,
          nextAttemptAt: clock.now(),
        },
        clock.now(),
      );

    const processReminder = async (
      reminder: ClaimedReminder,
      laterReminders: ClaimedReminder[],
      handledReminderIds: Set<string>,
    ): Promise<void> => {
      const recordOutcome = (status: ReminderOutcome, error: string | null, nextAttemptAt: Date | null) =>
        queue.finish(
          { reminderId: reminder.reminderId, attempts: reminder.attempts, status, error, nextAttemptAt },
          clock.now(),
        );

      /** Contrato 2: depois de qualquer desfecho, se a tarefa mudou desde a reserva, refaz os lembretes dela. */
      const runBestEffort = async (work: () => Promise<void>): Promise<void> => {
        try {
          await work();
        } catch (error) {
          // O desfecho já foi gravado: falha de ressincronização só é registrada (nome do erro), nunca propaga.
          logger?.error('reminder.resync_failed', { reminderId: reminder.reminderId, errorName: errorNameOf(error) });
        }
      };
      const resyncIfChanged = (): Promise<void> =>
        runBestEffort(async () => {
          const currentTask = await tasks.get(reminder.userId, reminder.taskId);
          if (currentTask !== null && !isClosedTask(currentTask) && taskChangedSinceClaim(reminder, currentTask)) {
            await syncReminders(reminder.userId, currentTask, await profiles.get(reminder.userId));
          }
        });
      const markAttemptsExhausted = async (): Promise<void> => {
        await recordOutcome('falhou', 'tentativas_esgotadas', null);
        result.failed += 1;
        logger?.error('reminder.failed', {
          reminderId: reminder.reminderId,
          attempts: reminder.attempts,
          reason: 'tentativas_esgotadas',
        });
        await resyncIfChanged();
      };

      if (reminder.attempts > MAX_ATTEMPTS) {
        await markAttemptsExhausted();
        return;
      }

      // Rechecagem da tarefa: pode ter sido encerrada, perdido a data ou remarcada depois da reserva.
      const task = await tasks.get(reminder.userId, reminder.taskId);
      if (task === null || isClosedTask(task)) {
        await recordOutcome('cancelado', 'tarefa_encerrada', null);
        result.cancelled += 1;
        return;
      }
      if (task.dueDate === null) {
        await recordOutcome('cancelado', 'sem_data', null);
        result.cancelled += 1;
        await runBestEffort(async () => syncReminders(reminder.userId, task, await profiles.get(reminder.userId)));
        return;
      }
      if (taskChangedSinceClaim(reminder, task)) {
        await recordOutcome('cancelado', 'remarcada', null);
        result.cancelled += 1;
        await runBestEffort(async () => syncReminders(reminder.userId, task, await profiles.get(reminder.userId)));
        return;
      }

      const text = renderReminder({
        kind: reminder.kind,
        title: reminder.title,
        taskType: reminder.taskType,
        dueDate: reminder.dueDate,
        dueTime: reminder.dueTime,
        fatal: reminder.fatal,
        late: isLate(reminder.scheduledAt, clock.now()),
      });
      const sendStartedAt = clock.now().getTime();
      const sendResult = await telegram!.sendMessage(reminder.chatId, text);

      if (sendResult.ok) {
        try {
          await recordOutcome('enviado', null, null);
        } catch (error) {
          // A mensagem saiu mas o registro falhou: a recuperação pode reenviar (pelo menos uma vez).
          logger?.error('reminder.sent_unrecorded', {
            reminderId: reminder.reminderId,
            error: error instanceof ReminderLeaseError ? error.code : errorNameOf(error),
          });
          throw error;
        }
        result.sent += 1;
        logger?.info('reminder.sent', {
          reminderId: reminder.reminderId,
          attempts: reminder.attempts,
          durationMs: clock.now().getTime() - sendStartedAt,
        });
        await resyncIfChanged();
        return;
      }

      const sendError = sendResult.error;
      if (sendError.kind === 'transient') {
        const backoffMs = retryDelayMs(reminder.attempts);
        if (backoffMs === null) {
          await markAttemptsExhausted();
          return;
        }
        // Respeita o `retry_after` do Telegram quando ele pede mais que o nosso backoff (com teto).
        const waitMs = Math.max(backoffMs, Math.min(sendError.retryAfterMs ?? 0, MAX_RETRY_AFTER_MS));
        await recordOutcome('pendente', 'transitorio', new Date(clock.now().getTime() + waitMs));
        result.retried += 1;
        logger?.info('reminder.retry', { reminderId: reminder.reminderId, attempts: reminder.attempts, waitMs });
        await resyncIfChanged();
        return;
      }

      await recordOutcome('falhou', sendError.reason, null);
      result.failed += 1;
      logger?.error('reminder.failed', { reminderId: reminder.reminderId, attempts: reminder.attempts, reason: sendError.reason });

      if (CHANNEL_BLOCKING_REASONS.has(sendError.reason)) {
        if (!pausedUserIds.has(reminder.userId)) {
          pausedUserIds.add(reminder.userId);
          await queue.pauseChannel(reminder.userId);
          result.paused += 1;
          logger?.error('reminder.channel_paused', { userId: reminder.userId, reason: sendError.reason });
        }
        // Os outros lembretes do mesmo usuário neste lote nem tentam: voltam a `pendente` com o canal pausado.
        for (const sibling of laterReminders) {
          if (sibling.userId !== reminder.userId || handledReminderIds.has(sibling.reminderId)) continue;
          handledReminderIds.add(sibling.reminderId);
          await runIgnoringLeaseLoss(sibling.reminderId, () => returnToPending(sibling, 'canal_pausado'));
        }
      }
      // Depois da pausa e da devolução dos irmãos: a ressincronização nunca pode impedi-las.
      await resyncIfChanged();
    };

    if (telegram === undefined) {
      logger?.info('reminders.run', { ...result, durationMs: clock.now().getTime() - startedAt, telegram: false });
      return result;
    }

    const isOverBudget = () => clock.now().getTime() - startedAt > budgetMs;
    let outOfTime = false;

    for (let batch = 0; batch < maxBatches && !outOfTime; batch += 1) {
      if (isOverBudget()) break;
      const claimed = await queue.claimDue(clock.now(), batchSize);
      if (claimed.length === 0) break;
      const handledReminderIds = new Set<string>();
      for (let i = 0; i < claimed.length; i += 1) {
        const reminder = claimed[i]!;
        if (handledReminderIds.has(reminder.reminderId)) continue;
        // Sem tempo: o resto do lote já reservado volta a `pendente` em vez de ficar preso em `enviando`.
        if (outOfTime || isOverBudget()) {
          outOfTime = true;
          result.deferred += 1;
          logger?.info('reminder.deferred', { reminderId: reminder.reminderId, reason: 'orcamento_de_tempo' });
          await runIgnoringLeaseLoss(reminder.reminderId, () => returnToPending(reminder, 'orcamento_de_tempo'));
          continue;
        }
        await runIgnoringLeaseLoss(reminder.reminderId, () =>
          processReminder(reminder, claimed.slice(i + 1), handledReminderIds),
        );
      }
    }

    logger?.info('reminders.run', { ...result, durationMs: clock.now().getTime() - startedAt, telegram: true });
    return result;
  };
}
