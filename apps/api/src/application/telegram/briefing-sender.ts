import { renderBriefing, type BriefingDto } from '@nexus/shared';
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

/** Tempo máximo de uma execução; o que sobrar fica para o próximo minuto. */
const DEFAULT_BUDGET_MS = 20_000;

const errorNameOf = (error: unknown): string => (error instanceof Error ? error.name : 'desconhecido');

/*
 * Envia o briefing do dia a quem está no horário. Cada dia é reservado (`claim`) antes do envio, para
 * que execuções concorrentes ou repetidas mandem no máximo um briefing por usuário e dia.
 *
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
    const isOverBudget = () => clock.now().getTime() - startedAt > budgetMs;

    /** Desfaz o claim para o próximo minuto tentar; falha ao desfazer só é registrada. */
    const releaseDay = async (recipient: BriefingRecipient): Promise<void> => {
      try {
        await briefings.release(recipient.userId, recipient.localDate);
      } catch (error) {
        logger?.error('briefing.release_failed', { userId: recipient.userId, errorName: errorNameOf(error) });
      }
    };

    /** Reserva o dia, monta e envia; falha transitória libera o dia, falha permanente não. */
    const sendBriefingTo = async (recipient: BriefingRecipient): Promise<void> => {
      if (!(await briefings.claim(recipient.userId, recipient.localDate))) return; // outra execução já tem o dia

      let text: string;
      try {
        text = renderBriefing(await getBriefing(recipient.userId));
      } catch (error) {
        result.failed += 1;
        logger?.error('briefing.build_failed', { userId: recipient.userId, errorName: errorNameOf(error) });
        await releaseDay(recipient);
        return;
      }

      if (text === '') {
        result.skippedEmpty += 1;
        logger?.info('briefing.skipped_empty', { userId: recipient.userId, localDate: recipient.localDate });
        return;
      }

      let sendResult: Awaited<ReturnType<TelegramClient['sendMessage']>>;
      try {
        sendResult = await telegram.sendMessage(recipient.chatId, text);
      } catch (error) {
        // Não se sabe se saiu: o dia fica reservado (no máximo um envio por dia).
        result.failed += 1;
        logger?.error('briefing.send_unexpected', { userId: recipient.userId, errorName: errorNameOf(error) });
        return;
      }

      if (sendResult.ok) {
        result.sent += 1;
        logger?.info('briefing.sent', { userId: recipient.userId, localDate: recipient.localDate });
        return;
      }

      const sendError = sendResult.error;
      if (sendError.kind === 'transient') {
        result.retried += 1;
        logger?.info('briefing.retry', { userId: recipient.userId, localDate: recipient.localDate });
        await releaseDay(recipient);
        return;
      }

      result.failed += 1;
      logger?.error('briefing.failed', { userId: recipient.userId, localDate: recipient.localDate, reason: sendError.reason });
      // Bot bloqueado ou chat apagado: insistir não adianta, então o canal é pausado para o usuário.
      const isChatUnreachable = sendError.reason === 'bot_bloqueado' || sendError.reason === 'chat_inexistente';
      if (isChatUnreachable) {
        try {
          await queue.pauseChannel(recipient.userId);
          result.paused += 1;
          logger?.error('briefing.channel_paused', { userId: recipient.userId, reason: sendError.reason });
        } catch (error) {
          logger?.error('briefing.pause_failed', { userId: recipient.userId, errorName: errorNameOf(error) });
        }
      }
    };

    const dueRecipients = await briefings.dueFor(clock.now());
    for (let i = 0; i < dueRecipients.length; i += 1) {
      if (isOverBudget()) {
        const remaining = dueRecipients.length - i;
        result.deferred += remaining;
        logger?.info('briefing.deferred', { count: remaining, reason: 'orcamento_de_tempo' });
        break;
      }
      const recipient = dueRecipients[i]!;
      try {
        await sendBriefingTo(recipient);
      } catch (error) {
        result.failed += 1;
        logger?.error('briefing.unexpected_error', { userId: recipient.userId, errorName: errorNameOf(error) });
      }
    }

    logger?.info('briefings.run', { ...result, durationMs: clock.now().getTime() - startedAt });
    return result;
  };
}
