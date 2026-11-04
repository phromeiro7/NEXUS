import type { Clock, MaintenanceRepository } from './ports.js';
import type { RemindersLogger, RunRemindersResult } from './run-reminders.js';
import type { SendDailyBriefingsResult } from './telegram/briefing-sender.js';

export type SchedulerResult = {
  reminders: RunRemindersResult;
  briefings: SendDailyBriefingsResult;
  eventsRecovered: { recovered: number; failed: number };
  purged: { chatMessages: number; linkCodes: number; modelCalls: number };
};

/** Orçamentos dos sub-passos (o pior caso real é de ~45 s: cada orçamento é checado antes de cada item, então o último ainda envia e ressincroniza; o `timeout_milliseconds` do `pg_net` é 60000). */
export const SCHEDULER_BUDGETS_MS = { reminders: 15_000, briefings: 8_000 } as const;

export type RunSchedulerDeps = {
  maintenance: MaintenanceRepository;
  runReminders: () => Promise<RunRemindersResult>;
  sendDailyBriefings: () => Promise<SendDailyBriefingsResult>;
  clock: Clock;
  logger?: RemindersLogger;
};

/**
 * Uma passada do agendador (chamada a cada minuto por um agendador externo). Cada etapa é isolada:
 * se uma falha, só o NOME do erro é registrado, ela contribui com zeros e as demais seguem.
 * Ordem: recuperar eventos presos, lembretes, briefings, limpezas.
 */
export function makeRunScheduler(deps: RunSchedulerDeps): () => Promise<SchedulerResult> {
  const { maintenance, clock, logger } = deps;

  const step = async <T>(name: string, fallback: T, work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (err) {
      logger?.error('scheduler.step_failed', { step: name, errorName: err instanceof Error ? err.name : 'desconhecido' });
      return fallback;
    }
  };

  return async () => {
    const eventsRecovered = await step('recover_stuck_events', { recovered: 0, failed: 0 }, () =>
      maintenance.recoverStuckEvents(clock.now()),
    );
    const reminders = await step<RunRemindersResult>(
      'reminders',
      { sent: 0, retried: 0, failed: 0, cancelled: 0, recovered: 0, paused: 0, leaseLost: 0, deferred: 0 },
      () => deps.runReminders(),
    );
    const briefings = await step<SendDailyBriefingsResult>(
      'briefings',
      { sent: 0, skippedEmpty: 0, retried: 0, failed: 0, paused: 0, deferred: 0 },
      () => deps.sendDailyBriefings(),
    );
    const chatMessages = await step('purge_chat_messages', 0, () => maintenance.purgeExpiredChatMessages(clock.now()));
    const linkCodes = await step('purge_link_codes', 0, () => maintenance.purgeExpiredLinkCodes(clock.now()));
    const modelCalls = await step('purge_model_calls', 0, () => maintenance.purgeOldModelCalls(clock.now()));

    const result: SchedulerResult = { reminders, briefings, eventsRecovered, purged: { chatMessages, linkCodes, modelCalls } };
    logger?.info('scheduler.run', {
      sent: reminders.sent,
      briefingsSent: briefings.sent,
      eventsRecovered: eventsRecovered.recovered,
      eventsFailed: eventsRecovered.failed,
    });
    return result;
  };
}
