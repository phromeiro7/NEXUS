import { renderBriefing, type BriefingDto } from '@aj/shared';
import type { BriefingRecipient, BriefingRepository, Clock, ReminderQueue, TelegramClient } from '../ports.js';
import type { RemindersLogger } from '../run-reminders.js';

export type SendDailyBriefingsDeps = {
  briefings: BriefingRepository;
  getBriefing: (userId: string) => Promise<BriefingDto>;
  /** Ausente = Telegram não configurado: nunca reserva o dia (Ruling 13). */
  telegram?: TelegramClient;
  queue: Pick<ReminderQueue, 'pauseChannel'>;
  clock: Clock;
  logger?: RemindersLogger;
  budgetMs?: number;
};

export type SendDailyBriefingsResult = {
  sent: number;
  skippedEmpty: number;
  retried: number;
  failed: number;
  paused: number;
  /** Não processados por falta de tempo e NÃO reservados: o próximo minuto os pega. */
  deferred: number;
};

const DEFAULT_BUDGET_MS = 20_000;

const errorName = (err: unknown): string => (err instanceof Error ? err.name : 'desconhecido');

/*
 * Logs: só nomes de evento, contagens, códigos de motivo e nomes de erro. Nunca o texto do
 * briefing, títulos de tarefas nem o chat id.
 */
export function makeSendDailyBriefings(deps: SendDailyBriefingsDeps) {
  const { briefings, getBriefing, telegram, queue, clock, logger } = deps;
  const budgetMs = deps.budgetMs ?? DEFAULT_BUDGET_MS;

  return async (): Promise<SendDailyBriefingsResult> => {
    const result: SendDailyBriefingsResult = { sent: 0, skippedEmpty: 0, retried: 0, failed: 0, paused: 0, deferred: 0 };
    if (telegram === undefined) return result;

    const startedAt = clock.now().getTime();
    const overBudget = () => clock.now().getTime() - startedAt > budgetMs;

    /** Desfaz o claim para o próximo minuto tentar; falha ao desfazer só é registrada. */
    const release = async (r: BriefingRecipient): Promise<void> => {
      try {
        await briefings.release(r.userId, r.localDate);
      } catch (err) {
        logger?.error('briefing.release_failed', { userId: r.userId, errorName: errorName(err) });
      }
    };

    const processOne = async (r: BriefingRecipient): Promise<void> => {
      if (!(await briefings.claim(r.userId, r.localDate))) return; // outra execução já tem o dia

      let text: string;
      try {
        text = renderBriefing(await getBriefing(r.userId));
      } catch (err) {
        result.failed += 1;
        logger?.error('briefing.build_failed', { userId: r.userId, errorName: errorName(err) });
        await release(r);
        return;
      }

      if (text === '') {
        result.skippedEmpty += 1;
        logger?.info('briefing.skipped_empty', { userId: r.userId, localDate: r.localDate });
        return;
      }

      let sendResult: Awaited<ReturnType<TelegramClient['sendMessage']>>;
      try {
        sendResult = await telegram.sendMessage(r.chatId, text);
      } catch (err) {
        // Não se sabe se saiu: o dia fica reservado (no máximo um envio por dia).
        result.failed += 1;
        logger?.error('briefing.send_unexpected', { userId: r.userId, errorName: errorName(err) });
        return;
      }

      if (sendResult.ok) {
        result.sent += 1;
        logger?.info('briefing.sent', { userId: r.userId, localDate: r.localDate });
        return;
      }

      const error = sendResult.error;
      if (error.kind === 'transient') {
        result.retried += 1;
        logger?.info('briefing.retry', { userId: r.userId, localDate: r.localDate });
        await release(r);
        return;
      }

      result.failed += 1;
      logger?.error('briefing.failed', { userId: r.userId, localDate: r.localDate, reason: error.reason });
      if (error.reason === 'bot_bloqueado' || error.reason === 'chat_inexistente') {
        try {
          await queue.pauseChannel(r.userId);
          result.paused += 1;
          logger?.error('briefing.channel_paused', { userId: r.userId, reason: error.reason });
        } catch (err) {
          logger?.error('briefing.pause_failed', { userId: r.userId, errorName: errorName(err) });
        }
      }
    };

    const due = await briefings.dueFor(clock.now());
    for (let i = 0; i < due.length; i += 1) {
      if (overBudget()) {
        const remaining = due.length - i;
        result.deferred += remaining;
        logger?.info('briefing.deferred', { count: remaining, reason: 'orcamento_de_tempo' });
        break;
      }
      const r = due[i]!;
      try {
        await processOne(r);
      } catch (err) {
        result.failed += 1;
        logger?.error('briefing.unexpected_error', { userId: r.userId, errorName: errorName(err) });
      }
    }

    logger?.info('briefings.run', { ...result, durationMs: clock.now().getTime() - startedAt });
    return result;
  };
}
