import { QR_LOGIN_START_PREFIX, type AssistantReplyDto } from '@nexus/shared';
import { z } from 'zod';
import type { TelegramErrorClass } from '../../domain/reminder-message.js';
import type { AssistantLogger, ProcessMessageInput } from '../assistant/process-message.js';
import {
  AssistantUnavailableError,
  EventInProgressError,
  ForbiddenError,
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
  InlineKeyboard,
  LinkCodeRepository,
  TelegramClient,
} from '../ports.js';
import { inviteShareUrl, type AcceptInviteResult, type makeInviteUseCases } from '../invites.js';
import type { QrLoginUseCases } from '../qr-login.js';
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

type CallbackQuery = NonNullable<z.infer<typeof updateSchema>['callback_query']>;

/** Textos fixos que o bot envia em resposta. */
const REPLY_MESSAGES = {
  startHelp: 'Para vincular, gere um código no painel (Configurações) e envie /start CÓDIGO.',
  linkedNoHint:
    'Conta vinculada! Você receberá lembretes e o briefing do dia aqui. Se não foi você quem gerou o código no painel, envie /desvincular.',
  invalidCode: 'Código inválido ou vencido. Gere outro no painel.',
  chatInUse: 'Este Telegram já está ligado a outra conta.',
  tooManyAttempts: 'Muitas tentativas. Tente de novo em alguns minutos.',
  notLinked: 'Esta conta ainda não está vinculada. Gere um código no painel (Configurações) e envie /start CÓDIGO.',
  unlinkedDone: 'Telegram desvinculado. Você não receberá mais lembretes por aqui.',
  onlyText: 'Por enquanto só entendo texto.',
  taskGone: 'Essa tarefa não existe mais.',
  rateLimited: 'Limite de 30 mensagens por hora atingido.',
  tooLong: 'Sua mensagem é longa demais (limite de 1.000 caracteres).',
  unavailable: 'O assistente está indisponível agora. Nada foi alterado.',
  inProgress: 'Sua mensagem anterior ainda está sendo processada. Aguarde um instante.',
  captureFailed: 'Não consegui anotar agora. Nada foi salvo. Tente de novo.',
  linkFirst: 'Vincule sua conta primeiro: gere um código no Nexus e envie /start CÓDIGO.',
  inviteInvalid: 'Convite inválido ou expirado.',
  inviteCreated: 'Pronto, sua conta foi criada.',
  alreadyLinked: 'Este Telegram já está ligado a uma conta.',
  inviteFailed: 'Não consegui criar a conta agora. Tente abrir o convite de novo em instantes.',
  adminOnly: 'Só administradores criam convites.',
  loginNoAccount: 'Este Telegram ainda não tem acesso ao Nexus. Peça um convite.',
  loginInvalid: 'Este código de login já foi usado ou expirou. Gere um novo no computador.',
  loginFailed: 'Não consegui abrir o login agora. Gere um novo código no computador e tente de novo.',
  loginApproved: 'Pronto, o painel foi liberado neste navegador. Se não foi você, envie /desvincular.',
  loginDenied: 'Tudo certo, o acesso foi bloqueado.',
  loginClosed: 'Esse pedido já foi respondido ou expirou.',
  noActiveInvites: 'Nenhum convite ativo. Envie /convite para criar um.',
  inviteRevoked: 'Convite revogado.',
  help: `Eu anoto gastos, contas e tarefas por mensagem. Exemplos:\n• gastei 45 no mercado\n• recebi 800 de um serviço\n• pagar a conta de internet amanhã às 10h\nNada é salvo antes de você tocar em Confirmar.`,
} as const;

/**
 * Confirmação do vínculo. Com a dica (e-mail mascarado), diz QUAL conta foi ligada: quem tocou num link
 * de outra pessoa (login CSRF) reconhece que a conta não é a sua. A dica nunca é registrada em log.
 */
function buildLinkedMessage(accountHint: string | null): string {
  if (accountHint === null) return REPLY_MESSAGES.linkedNoHint;
  return `Conta vinculada: ${accountHint}. Você receberá lembretes e o briefing do dia aqui. Se você não reconhece esta conta, envie /desvincular agora.`;
}

/** Código de vínculo gerado no painel: 8 caracteres. */
const LINK_CODE_FORMAT = /^[A-Z0-9]{8}$/;
/** Convite: 12 caracteres (o código de vínculo tem 8). */
const INVITE_CODE_FORMAT = /^[A-Z0-9]{12}$/;
/** Revogar convite pelo botão: `iv:r:<codigo>` (17 bytes, abaixo do limite de 64). */
const INVITE_REVOKE_CALLBACK_PREFIX = 'iv:r:';
/** Resposta do login do painel: `ql:y:<id>` (confirmar) ou `ql:n:<id>` ("Não fui eu"); o id é um uuid (41 bytes). */
const QR_LOGIN_CALLBACK_PREFIX = 'ql:';
const QR_LOGIN_CALLBACK_FORMAT = /^ql:(y|n):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
/** `/comando`, `/comando@bot` e `/comando argumentos`; o comando não distingue maiúsculas. */
const COMMAND_FORMAT = /^\/(start|desvincular|ajuda|convite|convites|meuid)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/i;

/** Falhas de `/start` toleradas por chat dentro da janela, antes de bloquear novas tentativas (contra força bruta). */
const MAX_FAILED_STARTS = 5;
const FAILED_START_WINDOW_MS = 10 * 60_000;
/** `/convites` lista no máximo esta quantidade (uma mensagem por convite). */
const MAX_LISTED_INVITES = 10;
const MS_PER_DAY = 86_400_000;
const INVITE_DISPLAY_TIME_ZONE = 'America/Sao_Paulo';

type CommandName = 'start' | 'desvincular' | 'ajuda' | 'convite' | 'convites' | 'meuid';

/**
 * Comando para o NOSSO bot: sem sufixo, ou com `@<nome>` igual ao nome configurado (sem distinguir
 * maiúsculas). Sufixo de outro bot (ou nome não configurado) não é comando: vira texto comum.
 */
function parseCommand(
  text: string,
  botUsername: string | undefined,
  allowedCommands: ReadonlySet<CommandName>,
): { name: CommandName; args: string } | null {
  const match = COMMAND_FORMAT.exec(text.trim());
  if (match === null) return null;
  const name = match[1]!.toLowerCase() as CommandName;
  // Comando desligado (ou de administrador, para quem não é) continua sendo texto comum: não revela que existe.
  if (!allowedCommands.has(name)) return null;
  const botSuffix = match[2];
  const isForAnotherBot =
    botSuffix !== undefined && (botUsername === undefined || botSuffix.toLowerCase() !== botUsername.toLowerCase());
  if (isForAnotherBot) return null;
  return { name, args: match[3] ?? '' };
}

const errorNameOf = (error: unknown) => (error instanceof Error ? error.name : 'desconhecido');

/** Código de log de uma falha de envio: só a classificação, nunca o texto. */
const sendFailureCode = (error: TelegramErrorClass): string =>
  error.kind === 'permanent' ? `permanent:${error.reason}` : 'transient';

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
  /** Convites ligados: `/convite`, `/convites` (administrador), `/meuid` e `/start CONVITE`. */
  invites?: Pick<ReturnType<typeof makeInviteUseCases>, 'isAdminChat' | 'create' | 'list' | 'revoke'>;
  acceptInvite?: (code: string, chatId: number) => Promise<AcceptInviteResult>;
  /** Login do painel por QR: `/start login_<nonce>` e os botões Confirmar / "Não fui eu". */
  qrLogin?: Pick<QrLoginUseCases, 'start' | 'decide'>;
  /** Origem https do Mini App: habilita o botão "Abrir o Nexus" depois do convite. */
  miniAppUrl?: string;
};

/**
 * Cria o tratador do webhook do Telegram: roteia cada `Update` (mensagem, comando ou toque em botão)
 * e garante que cada `update_id` só é tratado uma vez (reentregas do Telegram não duplicam efeitos).
 *
 * Logs: só nomes de evento, códigos e nomes de erro. Nunca texto de mensagem, títulos, o código de
 * vínculo, segredos nem o chat id.
 */
export function makeHandleTelegramUpdate(deps: HandleTelegramUpdateDeps) {
  const { links, events, confirmations, processMessage, telegram, clock, logger } = deps;
  const failedStartLimiter: FailedStartLimiter =
    deps.failedStartLimiter ?? createFailedStartLimiter({ max: MAX_FAILED_STARTS, windowMs: FAILED_START_WINDOW_MS });

  // Falhas de infraestrutura antes do registro do evento viram UpdateNotRegisteredError (a rota responde 500,
  // e o Telegram reenvia o update). ForeignEventError passa direto: é adulteração, não falha transitória.
  const beforeRegistration = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ForeignEventError) throw error;
      throw new UpdateNotRegisteredError(error);
    }
  };

  /**
   * Idempotência: registra o `update_id` para o usuário. `false` = reentrega de um update já tratado
   * (nada a fazer). `userId` nulo registra o evento sem dono (chat não vinculado).
   */
  const registerFirstDelivery = async (userId: string | null, updateId: number, now: Date): Promise<boolean> =>
    (await beforeRegistration(() => events.register(userId, 'telegram', String(updateId), now))).firstTime;

  /** Texto simples (sem parse_mode). Falha de envio: só o código da classificação é registrado. */
  async function sendPlainText(chatId: number, text: string): Promise<number | null> {
    const sent = await telegram.sendMessage(chatId, text);
    if (sent.ok) return sent.messageId;
    logger.error('telegram.send_failed', { code: sendFailureCode(sent.error) });
    return null;
  }

  /** Envia com botões; falha de envio só é registrada (como em `sendPlainText`). */
  async function sendWithKeyboard(chatId: number, text: string, options?: { keyboard: InlineKeyboard }): Promise<void> {
    const sent = await telegram.sendMessage(chatId, text, options);
    if (!sent.ok) logger.error('telegram.send_failed', { code: sendFailureCode(sent.error) });
  }

  /** Botão "Abrir o Nexus" (Mini App); sem origem configurada, nenhum botão. */
  const openMiniAppKeyboard = (): { keyboard: InlineKeyboard } | undefined =>
    deps.miniAppUrl === undefined ? undefined : { keyboard: [[{ text: 'Abrir o Nexus', webAppUrl: deps.miniAppUrl }]] };

  // ---------------------------------------------------------------------------------------------
  // Assistente de IA
  // ---------------------------------------------------------------------------------------------

  /**
   * Encaminha a mensagem ao assistente e responde no chat. Guarda quais tarefas a resposta afetou para que
   * uma resposta (reply) a essa mensagem mire nelas. Erros conhecidos viram textos curtos ao usuário.
   */
  async function forwardToAssistant(
    userId: string,
    chatId: number,
    updateId: number,
    text: string,
    targetTaskIds: string[] | undefined,
  ): Promise<void> {
    let assistantReply: AssistantReplyDto;
    try {
      assistantReply = await processMessage({
        userId,
        channel: 'telegram',
        externalId: String(updateId),
        text,
        source: 'telegram',
        ...(targetTaskIds !== undefined ? { targetTaskIds } : {}),
      });
    } catch (error) {
      if (error instanceof RateLimitedError) return void (await sendPlainText(chatId, REPLY_MESSAGES.rateLimited));
      if (error instanceof MessageTooLongError) return void (await sendPlainText(chatId, REPLY_MESSAGES.tooLong));
      if (error instanceof AssistantUnavailableError) return void (await sendPlainText(chatId, REPLY_MESSAGES.unavailable));
      if (error instanceof EventInProgressError) return void (await sendPlainText(chatId, REPLY_MESSAGES.inProgress));
      if (error instanceof TargetTasksGoneError) return void (await sendPlainText(chatId, REPLY_MESSAGES.taskGone));
      // Um conflito de `update_id` indica adulteração: nada é respondido ao remetente.
      if (error instanceof ForeignEventError) return logger.error('telegram.foreign_event', { code: errorNameOf(error) });
      return logger.error('telegram.process_failed', { errorName: errorNameOf(error) });
    }

    const messageId = await sendPlainText(chatId, formatAssistantReply(assistantReply.reply, assistantReply.affectedTasks));
    if (messageId === null || assistantReply.affectedTasks.length === 0) return;
    try {
      await confirmations.record(
        chatId,
        messageId,
        assistantReply.affectedTasks.map((task) => task.id),
      );
    } catch (error) {
      logger.error('telegram.confirmation_failed', { errorName: errorNameOf(error) });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Convites
  // ---------------------------------------------------------------------------------------------

  /** `/start CONVITE`: mensagem única para qualquer convite que não vale (não diz o motivo). */
  async function handleInviteStart(chatId: number, code: string, now: Date): Promise<void> {
    if (deps.acceptInvite === undefined) {
      failedStartLimiter.recordFailure(chatId, now);
      await sendPlainText(chatId, REPLY_MESSAGES.inviteInvalid);
      return;
    }
    let result: AcceptInviteResult;
    try {
      result = await deps.acceptInvite(code, chatId);
    } catch (error) {
      logger.error('telegram.invite_accept_failed', { errorName: errorNameOf(error) });
      await sendPlainText(chatId, REPLY_MESSAGES.inviteFailed);
      return;
    }
    if (result.status === 'invalido') {
      failedStartLimiter.recordFailure(chatId, now);
      await sendPlainText(chatId, REPLY_MESSAGES.inviteInvalid);
      return;
    }
    const text = result.status === 'criada' ? REPLY_MESSAGES.inviteCreated : REPLY_MESSAGES.alreadyLinked;
    await sendWithKeyboard(chatId, text, openMiniAppKeyboard());
  }

  /** `/convite`: cria um convite e manda o link com o botão de compartilhar. */
  async function sendNewInvite(userId: string, chatId: number): Promise<void> {
    const inviteUseCases = deps.invites!;
    const created = await inviteUseCases.create(userId);
    const validityDays = Math.max(
      1,
      Math.round((Date.parse(created.expiresAt) - Date.parse(created.createdAt)) / MS_PER_DAY),
    );
    await sendWithKeyboard(
      chatId,
      `Convite criado. Vale por ${validityDays} ${validityDays === 1 ? 'dia' : 'dias'} e abre uma conta só.\n${created.link}`,
      { keyboard: [[{ text: 'Compartilhar', url: inviteShareUrl(created.link) }]] },
    );
  }

  /** `/convites`: uma mensagem por convite ativo, cada uma com o botão "Revogar". */
  async function sendActiveInvites(userId: string, chatId: number): Promise<void> {
    const inviteUseCases = deps.invites!;
    const activeInvites = (await inviteUseCases.list(userId))
      .filter((invite) => invite.status === 'ativo')
      .slice(0, MAX_LISTED_INVITES);
    if (activeInvites.length === 0) return void (await sendPlainText(chatId, REPLY_MESSAGES.noActiveInvites));
    for (const invite of activeInvites) {
      const expiresOn = new Date(invite.expiresAt).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        timeZone: INVITE_DISPLAY_TIME_ZONE,
      });
      // Falha de envio de um item não interrompe a lista (o resultado não é verificado).
      await telegram.sendMessage(chatId, `Convite ativo, vale até ${expiresOn}.\n${invite.link}`, {
        keyboard: [[{ text: 'Revogar', callbackData: `${INVITE_REVOKE_CALLBACK_PREFIX}${invite.code}` }]],
      });
    }
  }

  /** `/convite` e `/convites` (só administrador, com conta vinculada). */
  async function handleInviteCommand(
    commandName: 'convite' | 'convites',
    userId: string | null,
    chatId: number,
  ): Promise<void> {
    if (userId === null) return void (await sendPlainText(chatId, REPLY_MESSAGES.linkFirst));
    try {
      if (commandName === 'convite') await sendNewInvite(userId, chatId);
      else await sendActiveInvites(userId, chatId);
    } catch (error) {
      if (error instanceof ForbiddenError) return void (await sendPlainText(chatId, REPLY_MESSAGES.adminOnly));
      logger.error('telegram.invite_failed', { errorName: errorNameOf(error) });
      await sendPlainText(chatId, REPLY_MESSAGES.captureFailed);
    }
  }

  /** Toque em "Revogar" de um convite (só administrador, em chat privado vinculado). */
  async function handleInviteRevokeCallback(updateId: number, callback: CallbackQuery): Promise<void> {
    const target = callback.message;
    if (deps.invites === undefined || target === undefined || target.chat.type !== 'private' || callback.data === undefined) return;
    const chatId = target.chat.id;
    const code = callback.data.slice(INVITE_REVOKE_CALLBACK_PREFIX.length);
    const now = clock.now();
    const userId = await beforeRegistration(() => links.userForChat(chatId));
    if (userId === null || !deps.invites.isAdminChat(chatId)) {
      await telegram.answerCallbackQuery(callback.id, REPLY_MESSAGES.adminOnly);
      return;
    }
    if (!(await registerFirstDelivery(userId, updateId, now))) return;
    try {
      await deps.invites.revoke(userId, code);
      await telegram.answerCallbackQuery(callback.id, REPLY_MESSAGES.inviteRevoked);
      await telegram.editMessageText(chatId, target.message_id, REPLY_MESSAGES.inviteRevoked);
    } catch (error) {
      // Já usado, revogado ou inexistente: nada a revogar. Fecha o botão sem alarde.
      logger.error('telegram.invite_revoke_failed', { errorName: errorNameOf(error) });
      await telegram.answerCallbackQuery(callback.id, REPLY_MESSAGES.inviteInvalid);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Login do painel por QR code
  // ---------------------------------------------------------------------------------------------

  /**
   * `/start login_<nonce>`: a pessoa leu o QR do painel. Sem conta, recusa. Com conta, pergunta se foi ela e deixa
   * claro que só se confirma se foi ela mesma quem abriu o painel (quem recebe um QR de outra pessoa cai aqui).
   */
  async function handleLoginStart(chatId: number, nonce: string, userId: string | null, now: Date): Promise<void> {
    let result: Awaited<ReturnType<NonNullable<typeof deps.qrLogin>['start']>>;
    try {
      result = await deps.qrLogin!.start({ nonce, chatId, userId });
    } catch (error) {
      logger.error('telegram.qr_login_failed', { errorName: errorNameOf(error) });
      await sendPlainText(chatId, REPLY_MESSAGES.loginFailed);
      return;
    }
    if (result.kind === 'invalido') {
      failedStartLimiter.recordFailure(chatId, now);
      await sendPlainText(chatId, REPLY_MESSAGES.loginInvalid);
      return;
    }
    if (result.kind === 'recusado') {
      await sendPlainText(chatId, REPLY_MESSAGES.loginNoAccount);
      return;
    }
    await sendWithKeyboard(
      chatId,
      `Entrar no painel do Nexus pelo navegador?\n${result.label} · ${result.time}\nConfirme só se foi você quem acabou de abrir o painel. Se alguém lhe enviou este link ou QR code, toque em Não fui eu.`,
      {
        keyboard: [
          [
            { text: 'Confirmar', callbackData: `${QR_LOGIN_CALLBACK_PREFIX}y:${result.requestId}` },
            { text: 'Não fui eu', callbackData: `${QR_LOGIN_CALLBACK_PREFIX}n:${result.requestId}` },
          ],
        ],
      },
    );
  }

  /** Toque em Confirmar / "Não fui eu" do login do painel (só no chat que abriu o pedido, para a conta dele). */
  async function handleLoginCallback(updateId: number, callback: CallbackQuery): Promise<void> {
    const target = callback.message;
    if (deps.qrLogin === undefined || target === undefined || target.chat.type !== 'private' || callback.data === undefined) return;
    const parsedCallback = QR_LOGIN_CALLBACK_FORMAT.exec(callback.data);
    if (parsedCallback === null) return;
    const chatId = target.chat.id;
    const now = clock.now();
    const userId = await beforeRegistration(() => links.userForChat(chatId));
    if (userId === null) {
      await telegram.answerCallbackQuery(callback.id, REPLY_MESSAGES.loginNoAccount);
      return;
    }
    if (!(await registerFirstDelivery(userId, updateId, now))) return;
    const approve = parsedCallback[1]!.toLowerCase() === 'y';
    let decision: Awaited<ReturnType<NonNullable<typeof deps.qrLogin>['decide']>>;
    try {
      decision = await deps.qrLogin.decide({ requestId: parsedCallback[2]!, chatId, userId, approve });
    } catch (error) {
      logger.error('telegram.qr_login_callback_failed', { errorName: errorNameOf(error) });
      await telegram.answerCallbackQuery(callback.id, REPLY_MESSAGES.captureFailed);
      return;
    }
    // Já respondido ou vencido: só um aviso curto. A mensagem não é reescrita (um segundo toque não apaga a resposta certa).
    if (decision === 'expirado') {
      await telegram.answerCallbackQuery(callback.id, REPLY_MESSAGES.loginClosed);
      return;
    }
    const text = decision === 'aprovado' ? REPLY_MESSAGES.loginApproved : REPLY_MESSAGES.loginDenied;
    await telegram.answerCallbackQuery(callback.id, text);
    // Sem teclado: os botões somem e a mensagem fica como registro do que foi decidido.
    await telegram.editMessageText(chatId, target.message_id, text);
  }

  // ---------------------------------------------------------------------------------------------
  // Registro por regras (proposta com botões)
  // ---------------------------------------------------------------------------------------------

  /** Toque num botão da proposta do chat. Só existe com o registro por regras ligado. */
  async function handleCaptureCallback(updateId: number, callback: CallbackQuery): Promise<void> {
    const capture = deps.capture;
    const target = callback.message;
    if (capture === undefined || target === undefined || target.chat.type !== 'private' || callback.data === undefined) return;
    const chatId = target.chat.id;
    const now = clock.now();
    const userId = await beforeRegistration(() => links.userForChat(chatId));
    if (userId === null) {
      const result = await telegram.answerCallbackQuery(callback.id, REPLY_MESSAGES.linkFirst);
      if (!result.ok) logger.error('telegram.capture_answer_failed', { code: 'sem_vinculo' });
      return;
    }
    if (!(await registerFirstDelivery(userId, updateId, now))) return;
    try {
      await capture.handleCallback(userId, { id: callback.id, chatId, messageId: target.message_id, data: callback.data });
    } catch (error) {
      logger.error('telegram.capture_callback_failed', { errorName: errorNameOf(error) });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Comandos
  // ---------------------------------------------------------------------------------------------

  /** Comandos que este chat pode usar, conforme os recursos ligados e se o chat é de administrador. */
  function allowedCommandsFor(chatId: number): Set<CommandName> {
    const allowedCommands = new Set<CommandName>(['start', 'desvincular']);
    if (deps.capture !== undefined) allowedCommands.add('ajuda');
    if (deps.invites !== undefined) {
      allowedCommands.add('meuid');
      if (deps.invites.isAdminChat(chatId)) {
        allowedCommands.add('convite');
        allowedCommands.add('convites');
      }
    }
    return allowedCommands;
  }

  /**
   * `/start <argumento>`: login do painel por QR, convite ou código de vínculo (nesta ordem). Toda tentativa
   * inválida conta no limitador por chat, que bloqueia novas tentativas para impedir adivinhar códigos.
   */
  async function handleStartCommand(chatId: number, args: string, userId: string | null, now: Date): Promise<void> {
    const startArgument = args.trim();
    if (startArgument === '') return void (await sendPlainText(chatId, REPLY_MESSAGES.startHelp));
    if (!failedStartLimiter.allow(chatId, now)) return void (await sendPlainText(chatId, REPLY_MESSAGES.tooManyAttempts));
    // Login do painel: `login_<nonce>` (o nonce distingue maiúsculas, por isso antes do toUpperCase).
    if (deps.qrLogin !== undefined && startArgument.startsWith(QR_LOGIN_START_PREFIX)) {
      await handleLoginStart(chatId, startArgument.slice(QR_LOGIN_START_PREFIX.length), userId, now);
      return;
    }
    const code = startArgument.toUpperCase();
    if (INVITE_CODE_FORMAT.test(code)) {
      await handleInviteStart(chatId, code, now);
      return;
    }
    if (!LINK_CODE_FORMAT.test(code)) {
      failedStartLimiter.recordFailure(chatId, now);
      return void (await sendPlainText(chatId, REPLY_MESSAGES.invalidCode));
    }
    const outcome = await links.consume(code, chatId, now);
    if (outcome.status === 'ok') return void (await sendPlainText(chatId, buildLinkedMessage(outcome.accountHint)));
    failedStartLimiter.recordFailure(chatId, now);
    await sendPlainText(chatId, outcome.status === 'chat_em_uso' ? REPLY_MESSAGES.chatInUse : REPLY_MESSAGES.invalidCode);
  }

  // ---------------------------------------------------------------------------------------------
  // Roteamento do update
  // ---------------------------------------------------------------------------------------------

  async function handleUpdate(update: unknown): Promise<void> {
    const parsed = updateSchema.safeParse(update);
    if (!parsed.success) return;
    const { update_id: updateId, message, callback_query: callbackQuery } = parsed.data;

    // Toque em botão: o prefixo do `callback_data` diz de qual fluxo ele é.
    if (message === undefined) {
      if (callbackQuery?.data?.startsWith(INVITE_REVOKE_CALLBACK_PREFIX) === true) await handleInviteRevokeCallback(updateId, callbackQuery);
      else if (callbackQuery?.data?.startsWith(QR_LOGIN_CALLBACK_PREFIX) === true) await handleLoginCallback(updateId, callbackQuery);
      else if (callbackQuery !== undefined) await handleCaptureCallback(updateId, callbackQuery);
      return; // edited_message, channel_post...
    }
    // Grupos e canais são ignorados: o bot só conversa em chat privado.
    if (message.chat.type !== 'private') return;
    const chatId = message.chat.id;
    const now = clock.now();

    const userId = await beforeRegistration(() => links.userForChat(chatId));
    const text = message.text;
    const command = text === undefined ? null : parseCommand(text, deps.botUsername, allowedCommandsFor(chatId));

    /** Idempotência dos ramos sem modelo (Ruling 21): `false` = já tratado, nada a fazer. */
    const isFirstDelivery = (): Promise<boolean> => registerFirstDelivery(userId, updateId, now);

    if (text === undefined) {
      if (!(await isFirstDelivery())) return;
      await sendPlainText(chatId, REPLY_MESSAGES.onlyText);
      return;
    }

    if (command?.name === 'ajuda') {
      if (!(await isFirstDelivery())) return;
      await sendPlainText(chatId, REPLY_MESSAGES.help);
      return;
    }

    const invitesEnabled = deps.invites !== undefined;
    if (command?.name === 'meuid' && invitesEnabled) {
      if (!(await isFirstDelivery())) return;
      await sendPlainText(chatId, `Seu id do Telegram é ${chatId}.`);
      return;
    }

    if ((command?.name === 'convite' || command?.name === 'convites') && invitesEnabled) {
      if (!(await isFirstDelivery())) return;
      await handleInviteCommand(command.name, userId, chatId);
      return;
    }

    if (command?.name === 'desvincular') {
      if (!(await isFirstDelivery())) return;
      if (userId === null) return void (await sendPlainText(chatId, REPLY_MESSAGES.notLinked));
      await links.unlink(userId);
      await sendPlainText(chatId, REPLY_MESSAGES.unlinkedDone);
      return;
    }

    if (command?.name === 'start') {
      if (!(await isFirstDelivery())) return;
      await handleStartCommand(chatId, command.args, userId, now);
      return;
    }

    // Texto comum: daqui em diante exige conta vinculada.
    if (userId === null) {
      if (!(await isFirstDelivery())) return;
      await sendPlainText(chatId, REPLY_MESSAGES.notLinked);
      return;
    }

    // Resposta (reply) a uma confirmação do assistente: mira as tarefas daquela mensagem, se ainda existirem.
    let targetTaskIds: string[] | undefined;
    if (message.reply_to_message !== undefined) {
      const repliedTasks = await confirmations.tasksFor(userId, chatId, message.reply_to_message.message_id);
      if (repliedTasks.alive.length > 0) {
        targetTaskIds = repliedTasks.alive;
      } else if (repliedTasks.deletedCount > 0) {
        if (!(await isFirstDelivery())) return;
        await sendPlainText(chatId, REPLY_MESSAGES.taskGone);
        return;
      }
    }

    // Registro por regras: entendeu -> proposta com botões (nada é gravado antes de Confirmar). Não entendeu ->
    // assistente de IA, se houver; senão a ajuda curta. Resposta a uma confirmação do assistente continua com ele.
    const capture = deps.capture;
    if (capture !== undefined && targetTaskIds === undefined) {
      const proposal = await beforeRegistration(() => capture.interpret(userId, text));
      if (proposal !== null) {
        if (!(await isFirstDelivery())) return;
        try {
          await capture.propose(userId, chatId, proposal);
        } catch (error) {
          logger.error('telegram.capture_failed', { errorName: errorNameOf(error) });
          await sendPlainText(chatId, REPLY_MESSAGES.captureFailed);
        }
        return;
      }
      if (deps.assistantEnabled !== true) {
        if (!(await isFirstDelivery())) return;
        await sendPlainText(chatId, CAPTURE_HELP);
        return;
      }
    }

    // O `processMessage` faz o próprio registro do evento (externalId = update_id) e reproduz a resposta.
    await forwardToAssistant(userId, chatId, updateId, text, targetTaskIds);
  }

  return async (update: unknown): Promise<void> => {
    try {
      await handleUpdate(update);
    } catch (error) {
      // Registro do evento de outro usuário: adulteração, nunca responde.
      if (error instanceof ForeignEventError) return logger.error('telegram.foreign_event', { code: errorNameOf(error) });
      throw error;
    }
  };
}
