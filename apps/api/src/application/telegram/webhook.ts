import { QR_LOGIN_START_PREFIX, type AssistantReplyDto } from '@aj/shared';
import { z } from 'zod';
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
function linkedText(accountHint: string | null): string {
  if (accountHint === null) return TEXT.linkedNoHint;
  return `Conta vinculada: ${accountHint}. Você receberá lembretes e o briefing do dia aqui. Se você não reconhece esta conta, envie /desvincular agora.`;
}

const CODE_FORMAT = /^[A-Z0-9]{8}$/;
/** Convite: 12 caracteres (o código de vínculo tem 8). */
const INVITE_FORMAT = /^[A-Z0-9]{12}$/;
/** Revogar convite pelo botão: `iv:r:<codigo>` (17 bytes, abaixo do limite de 64). */
const REVOKE_PREFIX = 'iv:r:';
/** Resposta do login do painel: `ql:y:<id>` (confirmar) ou `ql:n:<id>` ("Não fui eu"); o id é um uuid (41 bytes). */
const LOGIN_PREFIX = 'ql:';
const LOGIN_CALLBACK = /^ql:(y|n):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
/** `/comando`, `/comando@bot` e `/comando argumentos`; o comando não distingue maiúsculas. */
const COMMAND = /^\/(start|desvincular|ajuda|convite|convites|meuid)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/i;

type CommandName = 'start' | 'desvincular' | 'ajuda' | 'convite' | 'convites' | 'meuid';

/**
 * Comando para o NOSSO bot: sem sufixo, ou com `@<nome>` igual ao nome configurado (sem distinguir
 * maiúsculas). Sufixo de outro bot (ou nome não configurado) não é comando: vira texto comum.
 */
function parseCommand(
  text: string,
  botUsername: string | undefined,
  allowed: ReadonlySet<CommandName>,
): { name: CommandName; args: string } | null {
  const m = COMMAND.exec(text.trim());
  if (m === null) return null;
  const name = m[1]!.toLowerCase() as CommandName;
  // Comando desligado (ou de administrador, para quem não é) continua sendo texto comum: não revela que existe.
  if (!allowed.has(name)) return null;
  const suffix = m[2];
  if (suffix !== undefined && (botUsername === undefined || suffix.toLowerCase() !== botUsername.toLowerCase())) {
    return null;
  }
  return { name, args: m[3] ?? '' };
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
  /** Convites ligados: `/convite`, `/convites` (administrador), `/meuid` e `/start CONVITE`. */
  invites?: Pick<ReturnType<typeof makeInviteUseCases>, 'isAdminChat' | 'create' | 'list' | 'revoke'>;
  acceptInvite?: (code: string, chatId: number) => Promise<AcceptInviteResult>;
  /** Login do painel por QR: `/start login_<nonce>` e os botões Confirmar / "Não fui eu". */
  qrLogin?: Pick<QrLoginUseCases, 'start' | 'decide'>;
  /** Origem https do Mini App: habilita o botão "Abrir o Nexus" depois do convite. */
  miniAppUrl?: string;
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

  /** Botão "Abrir o Nexus" (Mini App); sem origem configurada, nenhum botão. */
  const openKeyboard = (): { keyboard: InlineKeyboard } | undefined =>
    deps.miniAppUrl === undefined ? undefined : { keyboard: [[{ text: 'Abrir o Nexus', webAppUrl: deps.miniAppUrl }]] };

  /** `/start CONVITE`: mensagem única para qualquer convite que não vale (não diz o motivo). */
  async function handleInviteStart(chatId: number, code: string, now: Date): Promise<void> {
    if (deps.acceptInvite === undefined) {
      limiter.recordFailure(chatId, now);
      await say(chatId, TEXT.inviteInvalid);
      return;
    }
    let result: AcceptInviteResult;
    try {
      result = await deps.acceptInvite(code, chatId);
    } catch (error) {
      logger.error('telegram.invite_accept_failed', { errorName: errorName(error) });
      await say(chatId, TEXT.inviteFailed);
      return;
    }
    if (result.status === 'invalido') {
      limiter.recordFailure(chatId, now);
      await say(chatId, TEXT.inviteInvalid);
      return;
    }
    const text = result.status === 'criada' ? TEXT.inviteCreated : TEXT.alreadyLinked;
    const sent = await telegram.sendMessage(chatId, text, openKeyboard());
    if (!sent.ok) {
      logger.error('telegram.send_failed', { code: sent.error.kind === 'permanent' ? `permanent:${sent.error.reason}` : 'transient' });
    }
  }

  async function sendNewInvite(userId: string, chatId: number): Promise<void> {
    const invite = deps.invites!;
    const created = await invite.create(userId);
    const days = Math.max(1, Math.round((Date.parse(created.expiresAt) - Date.parse(created.createdAt)) / 86_400_000));
    const sent = await telegram.sendMessage(
      chatId,
      `Convite criado. Vale por ${days} ${days === 1 ? 'dia' : 'dias'} e abre uma conta só.\n${created.link}`,
      { keyboard: [[{ text: 'Compartilhar', url: inviteShareUrl(created.link) }]] },
    );
    if (!sent.ok) logger.error('telegram.send_failed', { code: sent.error.kind === 'permanent' ? `permanent:${sent.error.reason}` : 'transient' });
  }

  async function sendActiveInvites(userId: string, chatId: number): Promise<void> {
    const invite = deps.invites!;
    const active = (await invite.list(userId)).filter((i) => i.status === 'ativo').slice(0, 10);
    if (active.length === 0) return void (await say(chatId, TEXT.noActiveInvites));
    for (const item of active) {
      const until = new Date(item.expiresAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
      await telegram.sendMessage(chatId, `Convite ativo, vale até ${until}.\n${item.link}`, {
        keyboard: [[{ text: 'Revogar', callbackData: `${REVOKE_PREFIX}${item.code}` }]],
      });
    }
  }

  /** Toque em "Revogar" de um convite (só administrador, em chat privado vinculado). */
  async function handleInviteCallback(
    updateId: number,
    callback: NonNullable<z.infer<typeof updateSchema>['callback_query']>,
  ): Promise<void> {
    const target = callback.message;
    if (deps.invites === undefined || target === undefined || target.chat.type !== 'private' || callback.data === undefined) return;
    const chatId = target.chat.id;
    const code = callback.data.slice(REVOKE_PREFIX.length);
    const now = clock.now();
    const userId = await beforeRegistration(() => links.userForChat(chatId));
    if (userId === null || !deps.invites.isAdminChat(chatId)) {
      await telegram.answerCallbackQuery(callback.id, TEXT.adminOnly);
      return;
    }
    const first = await beforeRegistration(() => events.register(userId, 'telegram', String(updateId), now));
    if (!first.firstTime) return;
    try {
      await deps.invites.revoke(userId, code);
      await telegram.answerCallbackQuery(callback.id, TEXT.inviteRevoked);
      await telegram.editMessageText(chatId, target.message_id, TEXT.inviteRevoked);
    } catch (error) {
      // Já usado, revogado ou inexistente: nada a revogar. Fecha o botão sem alarde.
      logger.error('telegram.invite_revoke_failed', { errorName: errorName(error) });
      await telegram.answerCallbackQuery(callback.id, TEXT.inviteInvalid);
    }
  }

  /**
   * `/start login_<nonce>`: a pessoa leu o QR do painel. Sem conta, recusa. Com conta, pergunta se foi ela e deixa
   * claro que só se confirma se foi ela mesma quem abriu o painel (quem recebe um QR de outra pessoa cai aqui).
   */
  async function handleLoginStart(chatId: number, nonce: string, userId: string | null, now: Date): Promise<void> {
    let result: Awaited<ReturnType<NonNullable<typeof deps.qrLogin>['start']>>;
    try {
      result = await deps.qrLogin!.start({ nonce, chatId, userId });
    } catch (error) {
      logger.error('telegram.qr_login_failed', { errorName: errorName(error) });
      await say(chatId, TEXT.loginFailed);
      return;
    }
    if (result.kind === 'invalido') {
      limiter.recordFailure(chatId, now);
      await say(chatId, TEXT.loginInvalid);
      return;
    }
    if (result.kind === 'recusado') {
      await say(chatId, TEXT.loginNoAccount);
      return;
    }
    const sent = await telegram.sendMessage(
      chatId,
      `Entrar no painel do Nexus pelo navegador?\n${result.label} · ${result.time}\nConfirme só se foi você quem acabou de abrir o painel. Se alguém lhe enviou este link ou QR code, toque em Não fui eu.`,
      {
        keyboard: [
          [
            { text: 'Confirmar', callbackData: `${LOGIN_PREFIX}y:${result.requestId}` },
            { text: 'Não fui eu', callbackData: `${LOGIN_PREFIX}n:${result.requestId}` },
          ],
        ],
      },
    );
    if (!sent.ok) {
      logger.error('telegram.send_failed', { code: sent.error.kind === 'permanent' ? `permanent:${sent.error.reason}` : 'transient' });
    }
  }

  /** Toque em Confirmar / "Não fui eu" do login do painel (só no chat que abriu o pedido, para a conta dele). */
  async function handleLoginCallback(
    updateId: number,
    callback: NonNullable<z.infer<typeof updateSchema>['callback_query']>,
  ): Promise<void> {
    const target = callback.message;
    if (deps.qrLogin === undefined || target === undefined || target.chat.type !== 'private' || callback.data === undefined) return;
    const parsed = LOGIN_CALLBACK.exec(callback.data);
    if (parsed === null) return;
    const chatId = target.chat.id;
    const now = clock.now();
    const userId = await beforeRegistration(() => links.userForChat(chatId));
    if (userId === null) {
      await telegram.answerCallbackQuery(callback.id, TEXT.loginNoAccount);
      return;
    }
    const first = await beforeRegistration(() => events.register(userId, 'telegram', String(updateId), now));
    if (!first.firstTime) return;
    const approve = parsed[1]!.toLowerCase() === 'y';
    let decision: Awaited<ReturnType<NonNullable<typeof deps.qrLogin>['decide']>>;
    try {
      decision = await deps.qrLogin.decide({ requestId: parsed[2]!, chatId, userId, approve });
    } catch (error) {
      logger.error('telegram.qr_login_callback_failed', { errorName: errorName(error) });
      await telegram.answerCallbackQuery(callback.id, TEXT.captureFailed);
      return;
    }
    // Já respondido ou vencido: só um aviso curto. A mensagem não é reescrita (um segundo toque não apaga a resposta certa).
    if (decision === 'expirado') {
      await telegram.answerCallbackQuery(callback.id, TEXT.loginClosed);
      return;
    }
    const text = decision === 'aprovado' ? TEXT.loginApproved : TEXT.loginDenied;
    await telegram.answerCallbackQuery(callback.id, text);
    // Sem teclado: os botões somem e a mensagem fica como registro do que foi decidido.
    await telegram.editMessageText(chatId, target.message_id, text);
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
      if (callbackQuery?.data?.startsWith(REVOKE_PREFIX) === true) await handleInviteCallback(updateId, callbackQuery);
      else if (callbackQuery?.data?.startsWith(LOGIN_PREFIX) === true) await handleLoginCallback(updateId, callbackQuery);
      else if (callbackQuery !== undefined) await handleCallbackQuery(updateId, callbackQuery);
      return; // edited_message, channel_post...
    }
    if (message.chat.type !== 'private') return;
    const chatId = message.chat.id;
    const now = clock.now();

    const userId = await beforeRegistration(() => links.userForChat(chatId));
    const text = message.text;
    const allowed = new Set<CommandName>(['start', 'desvincular']);
    if (deps.capture !== undefined) allowed.add('ajuda');
    if (deps.invites !== undefined) {
      allowed.add('meuid');
      if (deps.invites.isAdminChat(chatId)) {
        allowed.add('convite');
        allowed.add('convites');
      }
    }
    const command = text === undefined ? null : parseCommand(text, deps.botUsername, allowed);

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

    const invites = deps.invites;
    if (command?.name === 'meuid' && invites !== undefined) {
      if (!(await firstTime())) return;
      await say(chatId, `Seu id do Telegram é ${chatId}.`);
      return;
    }

    if ((command?.name === 'convite' || command?.name === 'convites') && invites !== undefined) {
      if (!(await firstTime())) return;
      if (userId === null) return void (await say(chatId, TEXT.linkFirst));
      try {
        if (command.name === 'convite') await sendNewInvite(userId, chatId);
        else await sendActiveInvites(userId, chatId);
      } catch (error) {
        if (error instanceof ForbiddenError) return void (await say(chatId, TEXT.adminOnly));
        logger.error('telegram.invite_failed', { errorName: errorName(error) });
        await say(chatId, TEXT.captureFailed);
      }
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
      // Login do painel: `login_<nonce>` (o nonce distingue maiúsculas, por isso antes do toUpperCase).
      if (deps.qrLogin !== undefined && raw.startsWith(QR_LOGIN_START_PREFIX)) {
        await handleLoginStart(chatId, raw.slice(QR_LOGIN_START_PREFIX.length), userId, now);
        return;
      }
      const code = raw.toUpperCase();
      if (INVITE_FORMAT.test(code)) {
        await handleInviteStart(chatId, code, now);
        return;
      }
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
