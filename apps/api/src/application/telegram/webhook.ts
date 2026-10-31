import type { AssistantReplyDto } from '@aj/shared';
import { z } from 'zod';
import type { AssistantLogger, ProcessMessageInput } from '../assistant/process-message.js';
import {
  AssistantUnavailableError,
  EventInProgressError,
  ForeignEventError,
  MessageTooLongError,
  RateLimitedError,
  TargetTasksGoneError,
} from '../errors.js';
import type {
  Clock,
  ConfirmationRepository,
  InboundEventRepository,
  LinkCodeRepository,
  TelegramClient,
} from '../ports.js';
import { createFailedStartLimiter, type FailedStartLimiter } from './failed-start-limiter.js';
import { formatAssistantReply } from './reply-format.js';

/** Só os campos usados; o resto do `Update` é ignorado. Formato inesperado = ignora. */
const updateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      message_id: z.number().int(),
      chat: z.object({ id: z.number().int(), type: z.string() }),
      text: z.string().optional(),
      reply_to_message: z.object({ message_id: z.number().int() }).optional(),
    })
    .optional(),
});

const TEXT = {
  startHelp: 'Para vincular, gere um código no painel (Configurações) e envie /start CÓDIGO.',
  linked:
    'Conta vinculada! Você receberá lembretes e o briefing do dia aqui. Se não foi você quem gerou o código no painel, envie /desvincular.',
  invalidCode: 'Código inválido ou vencido. Gere outro no painel.',
  chatInUse: 'Este Telegram já está ligado a outra conta.',
  tooMany: 'Muitas tentativas. Tente de novo em alguns minutos.',
  unlinked: 'Esta conta ainda não está vinculada. Gere um código no painel (Configurações) e envie /start CÓDIGO.',
  unlinkedDone: 'Telegram desvinculado. Você não receberá mais lembretes por aqui.',
  onlyText: 'Por enquanto só entendo texto.',
  taskGone: 'Essa tarefa não existe mais.',
  rateLimited: 'Limite de 30 mensagens por hora atingido.',
  tooLong: 'Sua mensagem é longa demais (limite de 1.000 caracteres).',
  unavailable: 'O assistente está indisponível agora. Nada foi alterado.',
  inProgress: 'Sua mensagem anterior ainda está sendo processada. Aguarde um instante.',
} as const;

const CODE_FORMAT = /^[A-Z0-9]{8}$/;
const COMMAND = /^\/(start|desvincular)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/;

const errorName = (e: unknown) => (e instanceof Error ? e.name : 'desconhecido');

export type HandleTelegramUpdateDeps = {
  links: LinkCodeRepository;
  events: InboundEventRepository;
  confirmations: ConfirmationRepository;
  processMessage: (input: ProcessMessageInput) => Promise<AssistantReplyDto>;
  telegram: TelegramClient;
  clock: Clock;
  logger: AssistantLogger;
  failedStartLimiter?: FailedStartLimiter;
};

/*
 * Logs: só nomes de evento, códigos e nomes de erro. Nunca texto de mensagem, títulos, o código de
 * vínculo, segredos nem o chat id.
 */
export function makeHandleTelegramUpdate(deps: HandleTelegramUpdateDeps) {
  const { links, events, confirmations, processMessage, telegram, clock, logger } = deps;
  const limiter: FailedStartLimiter =
    deps.failedStartLimiter ?? createFailedStartLimiter({ max: 5, windowMs: 10 * 60_000 });

  /** Texto simples (sem parse_mode). Falha de envio: só o código da classificação é registrado. */
  async function say(chatId: number, text: string): Promise<number | null> {
    const sent = await telegram.sendMessage(chatId, text);
    if (sent.ok) return sent.messageId;
    const code = sent.error.kind === 'permanent' ? `permanent:${sent.error.reason}` : 'transient';
    logger.error('telegram.send_failed', { code });
    return null;
  }

  async function handleModelPath(
    userId: string,
    chatId: number,
    updateId: number,
    text: string,
    targetTaskIds: string[] | undefined,
  ): Promise<void> {
    let result: AssistantReplyDto;
    try {
      result = await processMessage({
        userId,
        channel: 'telegram',
        externalId: String(updateId),
        text,
        source: 'telegram',
        ...(targetTaskIds !== undefined ? { targetTaskIds } : {}),
      });
    } catch (error) {
      if (error instanceof RateLimitedError) return void (await say(chatId, TEXT.rateLimited));
      if (error instanceof MessageTooLongError) return void (await say(chatId, TEXT.tooLong));
      if (error instanceof AssistantUnavailableError) return void (await say(chatId, TEXT.unavailable));
      if (error instanceof EventInProgressError) return void (await say(chatId, TEXT.inProgress));
      if (error instanceof TargetTasksGoneError) return void (await say(chatId, TEXT.taskGone));
      // Um conflito de `update_id` indica adulteração: nada é respondido ao remetente.
      if (error instanceof ForeignEventError) return logger.error('telegram.foreign_event', { code: errorName(error) });
      return logger.error('telegram.process_failed', { errorName: errorName(error) });
    }

    const messageId = await say(chatId, formatAssistantReply(result.reply, result.affectedTasks));
    if (messageId === null || result.affectedTasks.length === 0) return;
    try {
      await confirmations.record(
        chatId,
        messageId,
        result.affectedTasks.map((t) => t.id),
      );
    } catch (error) {
      logger.error('telegram.confirmation_failed', { errorName: errorName(error) });
    }
  }

  async function handle(update: unknown): Promise<void> {
    const parsed = updateSchema.safeParse(update);
    if (!parsed.success) return;
    const { update_id: updateId, message } = parsed.data;
    if (message === undefined) return; // edited_message, channel_post, callback_query...
    if (message.chat.type !== 'private') return;
    const chatId = message.chat.id;
    const now = clock.now();

    const userId = await links.userForChat(chatId);
    const text = message.text;
    const command = text === undefined ? null : COMMAND.exec(text.trim());

    /** Idempotência dos ramos sem modelo (Ruling 21): `false` = já tratado, nada a fazer. */
    const firstTime = async (): Promise<boolean> =>
      (await events.register(userId, 'telegram', String(updateId), now)).firstTime;

    if (text === undefined) {
      if (!(await firstTime())) return;
      await say(chatId, TEXT.onlyText);
      return;
    }

    if (command?.[1] === 'desvincular') {
      if (!(await firstTime())) return;
      if (userId === null) return void (await say(chatId, TEXT.unlinked));
      await links.unlink(userId);
      await say(chatId, TEXT.unlinkedDone);
      return;
    }

    if (command?.[1] === 'start') {
      if (!(await firstTime())) return;
      const raw = (command[2] ?? '').trim();
      if (raw === '') return void (await say(chatId, TEXT.startHelp));
      if (!limiter.allow(chatId, now)) return void (await say(chatId, TEXT.tooMany));
      const code = raw.toUpperCase();
      if (!CODE_FORMAT.test(code)) {
        limiter.recordFailure(chatId, now);
        return void (await say(chatId, TEXT.invalidCode));
      }
      const outcome = await links.consume(code, chatId, now);
      if (outcome.status === 'ok') return void (await say(chatId, TEXT.linked));
      limiter.recordFailure(chatId, now);
      await say(chatId, outcome.status === 'chat_em_uso' ? TEXT.chatInUse : TEXT.invalidCode);
      return;
    }

    if (userId === null) {
      if (!(await firstTime())) return;
      await say(chatId, TEXT.unlinked);
      return;
    }

    let targets: string[] | undefined;
    if (message.reply_to_message !== undefined) {
      const found = await confirmations.tasksFor(userId, chatId, message.reply_to_message.message_id);
      if (found.alive.length > 0) {
        targets = found.alive;
      } else if (found.deletedCount > 0) {
        if (!(await firstTime())) return;
        await say(chatId, TEXT.taskGone);
        return;
      }
    }

    // O `processMessage` faz o próprio registro do evento (externalId = update_id) e reproduz a resposta.
    await handleModelPath(userId, chatId, updateId, text, targets);
  }

  return async (update: unknown): Promise<void> => {
    try {
      await handle(update);
    } catch (error) {
      // Registro do evento de outro usuário: adulteração, nunca responde.
      if (error instanceof ForeignEventError) return logger.error('telegram.foreign_event', { code: errorName(error) });
      throw error;
    }
  };
}
