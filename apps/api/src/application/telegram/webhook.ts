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
  UpdateNotRegisteredError,
} from '../errors.js';
import type {
  Clock,
  ConfirmationRepository,
  InboundEventRepository,
  LinkCodeRepository,
  TelegramClient,
} from '../ports.js';
import { CAPTURE_HELP, type CaptureFlow } from './capture.js';
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
  callback_query: z
    .object({
      id: z.string(),
      data: z.string().optional(),
      message: z.object({ message_id: z.number().int(), chat: z.object({ id: z.number().int(), type: z.string() }) }).optional(),
    })
    .optional(),
});

const TEXT = {
  startHelp: 'Para vincular, gere um código no painel (Configurações) e envie /start CÓDIGO.',
  linkedNoHint:
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
  captureFailed: 'Não consegui anotar agora. Nada foi salvo. Tente de novo.',
  linkFirst: 'Vincule sua conta primeiro: gere um código no Nexus e envie /start CÓDIGO.',
  help: `Eu anoto gastos, contas e tarefas por mensagem. Exemplos:\n• gastei 42 no almoço\n• luz 187,40 vence dia 8\n• ligar pra Ana amanhã 14h\nNada é salvo antes de você tocar em Confirmar.`,
} as const;

/**
 * Confirmação do vínculo. Com a dica (e-mail mascarado), diz QUAL conta foi ligada: quem tocou num link
 * de outra pessoa (login CSRF) reconhece que a conta não é a sua. A dica nunca é registrada em log.
 */
function linkedText(accountHint: string | null): string {
  if (accountHint === null) return TEXT.linkedNoHint;
  return `Conta vinculada: ${accountHint}. Você receberá lembretes e o briefing do dia aqui. Se você não reconhece esta conta, envie /desvincular agora.`;
}

const CODE_FORMAT =/^[A-Z0-9]{8}$/;
/** `/comando`, `/comando@bot` e `/comando argumentos`; o comando não distingue maiúsculas. */
const COMMAND = /^\/(start|desvincular|ajuda)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/i;

/**
 * Comando para o NOSSO bot: sem sufixo, ou com `@<nome>` igual ao nome configurado (sem distinguir
 * maiúsculas). Sufixo de outro bot (ou nome não configurado) não é comando: vira texto comum.
 */
function parseCommand(
  text: string,
  botUsername: string | undefined,
  withHelp: boolean,
): { name: 'start' | 'desvincular' | 'ajuda'; args: string } | null {
  const m = COMMAND.exec(text.trim());
  if (m === null) return null;
  // `/ajuda` só existe com o registro por regras ligado; sem ele continua sendo texto comum.
  if (m[1]!.toLowerCase() === 'ajuda' && !withHelp) return null;
  const suffix = m[2];
  if (suffix !== undefined && (botUsername === undefined || suffix.toLowerCase() !== botUsername.toLowerCase())) {
    return null;
  }
  return { name: m[1]!.toLowerCase() as 'start' | 'desvincular' | 'ajuda', args: m[3] ?? '' };
}

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
  /** Nome do NOSSO bot (sem @). `/comando@outro_bot` só é comando se o sufixo for este nome. */
  botUsername?: string;
  /** Registro por regras (propostas com botões). Ausente = tudo vai para o assistente, como antes. */
  capture?: CaptureFlow;
  /** O assistente de IA está configurado? Sem ele, o que as regras não entendem recebe a ajuda curta. */
  assistantEnabled?: boolean;
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

  /** Toque num botão da proposta do chat. Só existe com o registro por regras ligado. */
  async function handleCallbackQuery(
    updateId: number,
    callback: NonNullable<z.infer<typeof updateSchema>['callback_query']>,
  ): Promise<void> {
    const capture = deps.capture;
    const target = callback.message;
    if (capture === undefined || target === undefined || target.chat.type !== 'private' || callback.data === undefined) return;
    const chatId = target.chat.id;
    const now = clock.now();
    const userId = await beforeRegistration(() => links.userForChat(chatId));
    if (userId === null) {
      const result = await telegram.answerCallbackQuery(callback.id, TEXT.linkFirst);
      if (!result.ok) logger.error('telegram.capture_answer_failed', { code: 'sem_vinculo' });
      return;
    }
    const first = await beforeRegistration(() => events.register(userId, 'telegram', String(updateId), now));
    if (!first.firstTime) return;
    try {
      await capture.handleCallback(userId, { id: callback.id, chatId, messageId: target.message_id, data: callback.data });
    } catch (error) {
      logger.error('telegram.capture_callback_failed', { errorName: errorName(error) });
    }
  }

  // Falhas de infraestrutura antes do registro do evento viram UpdateNotRegisteredError (a rota responde 500).
  const beforeRegistration = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ForeignEventError) throw error;
      throw new UpdateNotRegisteredError(error);
    }
  };

  async function handle(update: unknown): Promise<void> {
    const parsed = updateSchema.safeParse(update);
    if (!parsed.success) return;
    const { update_id: updateId, message, callback_query: callbackQuery } = parsed.data;
    if (message === undefined) {
      if (callbackQuery !== undefined) await handleCallbackQuery(updateId, callbackQuery);
      return; // edited_message, channel_post...
    }
    if (message.chat.type !== 'private') return;
    const chatId = message.chat.id;
    const now = clock.now();

    const userId = await beforeRegistration(() => links.userForChat(chatId));
    const text = message.text;
    const command = text === undefined ? null : parseCommand(text, deps.botUsername, deps.capture !== undefined);

    /** Idempotência dos ramos sem modelo (Ruling 21): `false` = já tratado, nada a fazer. */
    const firstTime = async (): Promise<boolean> =>
      (await beforeRegistration(() => events.register(userId, 'telegram', String(updateId), now))).firstTime;

    if (text === undefined) {
      if (!(await firstTime())) return;
      await say(chatId, TEXT.onlyText);
      return;
    }

    if (command?.name === 'ajuda') {
      if (!(await firstTime())) return;
      await say(chatId, TEXT.help);
      return;
    }

    if (command?.name === 'desvincular') {
      if (!(await firstTime())) return;
      if (userId === null) return void (await say(chatId, TEXT.unlinked));
      await links.unlink(userId);
      await say(chatId, TEXT.unlinkedDone);
      return;
    }

    if (command?.name === 'start') {
      if (!(await firstTime())) return;
      const raw = command.args.trim();
      if (raw === '') return void (await say(chatId, TEXT.startHelp));
      if (!limiter.allow(chatId, now)) return void (await say(chatId, TEXT.tooMany));
      const code = raw.toUpperCase();
      if (!CODE_FORMAT.test(code)) {
        limiter.recordFailure(chatId, now);
        return void (await say(chatId, TEXT.invalidCode));
      }
      const outcome = await links.consume(code, chatId, now);
      if (outcome.status === 'ok') return void (await say(chatId, linkedText(outcome.accountHint)));
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

    // Registro por regras: entendeu -> proposta com botões (nada é gravado antes de Confirmar). Não entendeu ->
    // assistente de IA, se houver; senão a ajuda curta. Resposta a uma confirmação do assistente continua com ele.
    const capture = deps.capture;
    if (capture !== undefined && targets === undefined) {
      const proposal = await beforeRegistration(() => capture.interpret(userId, text));
      if (proposal !== null) {
        if (!(await firstTime())) return;
        try {
          await capture.propose(userId, chatId, proposal);
        } catch (error) {
          logger.error('telegram.capture_failed', { errorName: errorName(error) });
          await say(chatId, TEXT.captureFailed);
        }
        return;
      }
      if (deps.assistantEnabled !== true) {
        if (!(await firstTime())) return;
        await say(chatId, CAPTURE_HELP);
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
