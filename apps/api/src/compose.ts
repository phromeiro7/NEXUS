import { createClient } from '@supabase/supabase-js';
import type { TaskDto } from '@nexus/shared';
import { createApp } from './app.js';
import { makeProcessMessage } from './application/assistant/process-message.js';
import { makeToolExecutor } from './application/assistant/tools.js';
import { AssistantUnavailableError, NotFoundError } from './application/errors.js';
import { makeLinkUseCases } from './application/telegram/link.js';
import { makeCaptureFlow } from './application/telegram/capture.js';
import { makeTelegramWebhookHandler } from './application/telegram/webhook.js';
import { createSupabaseCaptureRepository } from './infra/supabase-capture-repository.js';
import { createSupabaseConfirmationRepository } from './infra/supabase-confirmation-repository.js';
import { createSupabaseLinkRepository } from './infra/supabase-link-repository.js';
import { makeAcceptInvite, makeInviteUseCases } from './application/invites.js';
import { createSupabaseAccountProvisioner } from './infra/supabase-account-provisioner.js';
import { createSupabaseInviteRepository } from './infra/supabase-invite-repository.js';
import { makeTelegramLogin } from './application/telegram/login.js';
import { makeQrLogin } from './application/qr-login.js';
import { createSupabaseQrLoginRepository } from './infra/supabase-qr-login-repository.js';
import { makeRateLimiter } from './application/telegram/rate-limit.js';
import { createSupabaseSessionIssuer, createSupabaseTelegramAuthRepository } from './infra/supabase-telegram-auth-repository.js';
import type { AssistantModel } from './application/ports.js';
import { createAnthropicAssistantModel } from './infra/anthropic-assistant-model.js';
import { createJsonLogger } from './infra/json-logger.js';
import { createSupabaseChatRepository } from './infra/supabase-chat-repository.js';
import { createSupabaseInboundEventRepository } from './infra/supabase-inbound-event-repository.js';
import { makeGetBriefing } from './application/briefing.js';
import { makeCaptureInterpretUseCases } from './application/capture-interpret.js';
import { makeFinanceUseCases } from './application/finance.js';
import type { Clock, TelegramClient } from './application/ports.js';
import { makeRunReminders } from './application/run-reminders.js';
import { makeRunScheduler, SCHEDULER_BUDGETS_MS } from './application/scheduler.js';
import { makeSendDailyBriefings } from './application/telegram/briefing-sender.js';
import { createSupabaseBriefingRepository } from './infra/supabase-briefing-repository.js';
import { createSupabaseMaintenanceRepository } from './infra/supabase-maintenance-repository.js';
import { createSupabaseReminderQueue } from './infra/supabase-reminder-queue.js';
import { createTelegramClient } from './infra/telegram-client.js';
import { makeSettingsUseCases } from './application/settings.js';
import { makeSyncReminders } from './application/sync-reminders.js';
import { makeTaskUseCases } from './application/tasks.js';
import type { Config } from './config.js';
import { createSupabaseAuthVerifier } from './infra/supabase-auth.js';
import { createSupabaseFinanceRepository } from './infra/supabase-finance-repository.js';
import { createSupabaseProfileRepository } from './infra/supabase-profile-repository.js';
import { createSupabaseReminderRepository } from './infra/supabase-reminder-repository.js';
import { createSupabaseTaskRepository } from './infra/supabase-task-repository.js';

const TEN_MINUTES_MS = 10 * 60_000;
const ONE_MINUTE_MS = 60_000;
/** Janela padrão do `auth_date` no login pelo Mini App, quando TELEGRAM_LOGIN_MAX_AGE_SECONDS não vem. */
const DEFAULT_TELEGRAM_LOGIN_MAX_AGE_SECONDS = 3600;
// Login por QR. Por IP: abrir e recarregar a tela de login. Por pedido: a consulta do navegador a cada ~2 s.
const QR_LOGIN_IP_LIMIT = { max: 20, windowMs: TEN_MINUTES_MS };
const QR_LOGIN_POLL_LIMIT = { max: 120, windowMs: ONE_MINUTE_MS };
// Login do Mini App. Por IP é folgado (vários aparelhos atrás do mesmo NAT); por usuário do Telegram é curto.
const TELEGRAM_LOGIN_IP_LIMIT = { max: 30, windowMs: TEN_MINUTES_MS };
const TELEGRAM_LOGIN_USER_LIMIT = { max: 10, windowMs: TEN_MINUTES_MS };

/**
 * Monta a API real (Supabase, repositórios e casos de uso). `clock`, `assistantModel` e
 * `telegramClient` só são sobrescritos em testes. Sem `assistantModel` nem `config.anthropicApiKey` o assistente fica
 * desabilitado (a rota responde 503 'configuracao') e o resto da API funciona normalmente.
 */
export function buildApp(
  config: Config,
  overrides?: { clock?: Clock; assistantModel?: AssistantModel; telegramClient?: TelegramClient },
): ReturnType<typeof createApp> {
  // Cliente com a service role (ignora RLS): cada repositório filtra por `user_id` explicitamente.
  // Sem sessão persistida nem refresh: o servidor não tem usuário logado próprio.
  const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const finance = createSupabaseFinanceRepository(supabase);
  const profiles = createSupabaseProfileRepository(supabase);
  const reminders = createSupabaseReminderRepository(supabase);
  const tasks = createSupabaseTaskRepository(supabase);
  const clock: Clock = overrides?.clock ?? { now: () => new Date() };
  const taskUseCases = makeTaskUseCases({ tasks, profiles, reminders, clock });

  const inboundEvents = createSupabaseInboundEventRepository(supabase);
  const assistantModel: AssistantModel | undefined =
    overrides?.assistantModel ??
    (config.anthropicApiKey !== undefined
      ? createAnthropicAssistantModel({ apiKey: config.anthropicApiKey, model: config.assistantModel })
      : undefined);
  const processMessage =
    assistantModel === undefined
      ? undefined
      : makeProcessMessage({
          model: assistantModel,
          executor: makeToolExecutor({ tasks: taskUseCases, profiles, clock }),
          chat: createSupabaseChatRepository(supabase),
          events: inboundEvents,
          profiles,
          clock,
          // Tarefas citadas pela conversa: as que sumiram (apagadas) são ignoradas, não viram erro.
          tasksByIds: async (userId, ids) => {
            const foundTasks: TaskDto[] = [];
            for (const taskId of ids) {
              try {
                foundTasks.push(await taskUseCases.get(userId, taskId));
              } catch (error) {
                if (!(error instanceof NotFoundError)) throw error;
              }
            }
            return foundTasks;
          },
          logger: createJsonLogger(),
        });

  // Telegram: cliente real só com token (ou o falso de teste). Sem ele o agendador ainda recupera,
  // cancela e limpa, mas nunca reserva nem envia (Ruling 13).
  const telegram: TelegramClient | undefined =
    overrides?.telegramClient ??
    (config.telegramBotToken !== undefined ? createTelegramClient({ token: config.telegramBotToken }) : undefined);
  const logger = createJsonLogger();
  const reminderQueue = createSupabaseReminderQueue(supabase);
  const syncReminders = makeSyncReminders({ reminders, clock });
  const getBriefing = makeGetBriefing({ tasks, profiles, clock });
  const runReminders = makeRunReminders({
    queue: reminderQueue,
    ...(telegram !== undefined ? { telegram } : {}),
    tasks,
    profiles,
    syncReminders,
    clock,
    logger,
  });
  const sendDailyBriefings = makeSendDailyBriefings({
    briefings: createSupabaseBriefingRepository(supabase, { logger }),
    getBriefing,
    ...(telegram !== undefined ? { telegram } : {}),
    queue: reminderQueue,
    clock,
    logger,
    budgetMs: SCHEDULER_BUDGETS_MS.briefings,
  });
  const captures = createSupabaseCaptureRepository(supabase);
  const financeUseCases = makeFinanceUseCases({ finance, clock });
  const telegramAuth = createSupabaseTelegramAuthRepository(supabase);
  const qrRequests = createSupabaseQrLoginRepository(supabase);
  const sessionIssuer = createSupabaseSessionIssuer(supabase);
  // Login do painel por QR: precisa do bot recebendo mensagens (webhook) e do nome do bot para o link.
  const qrLogin =
    telegram !== undefined && config.telegramWebhookSecret !== undefined && config.telegramBotUsername !== undefined
      ? makeQrLogin({
          requests: qrRequests,
          sessions: sessionIssuer,
          botUsername: config.telegramBotUsername,
          profiles,
          ipLimiter: makeRateLimiter({ ...QR_LOGIN_IP_LIMIT, clock }),
          pollLimiter: makeRateLimiter({ ...QR_LOGIN_POLL_LIMIT, clock }),
          clock,
        })
      : undefined;
  const scheduler = makeRunScheduler({
    maintenance: createSupabaseMaintenanceRepository(supabase),
    purgeCaptures: (now) => captures.purgeExpired(now),
    purgeTelegramAuth: (now) => telegramAuth.purgeExpired(now),
    ...(qrLogin !== undefined ? { purgeQrLogin: (now: Date) => qrLogin.purgeExpired(now) } : {}),
    runReminders: () => runReminders({ budgetMs: SCHEDULER_BUDGETS_MS.reminders }),
    sendDailyBriefings,
    clock,
    logger,
  });

  // Vínculo e webhook do Telegram. O webhook só existe com cliente do Telegram E segredo configurados;
  // sem eles a rota responde 503 'webhook_desabilitado' e o resto da API funciona.
  const links = createSupabaseLinkRepository(supabase);
  // Convites: administradores vêm de ADMIN_TELEGRAM_USER_IDS; sem token do bot não há link para compartilhar.
  const inviteUseCases = makeInviteUseCases({
    invites: createSupabaseInviteRepository(supabase),
    accounts: createSupabaseAccountProvisioner(supabase),
    adminTelegramIds: new Set(config.adminTelegramUserIds ?? []),
    botUsername: config.telegramBotUsername,
    ...(config.inviteTtlDays !== undefined ? { ttlDays: config.inviteTtlDays } : {}),
    clock,
  });
  const acceptInvite = makeAcceptInvite({
    invites: createSupabaseInviteRepository(supabase),
    accounts: createSupabaseAccountProvisioner(supabase),
    links,
    clock,
  });
  const telegramLink = makeLinkUseCases({ links, botUsername: config.telegramBotUsername, clock });
  const handleTelegramUpdate =
    telegram !== undefined && config.telegramWebhookSecret !== undefined
      ? makeTelegramWebhookHandler({
          links,
          events: inboundEvents,
          confirmations: createSupabaseConfirmationRepository(supabase),
          // Sem modelo (sem chave): o usuário recebe o aviso de indisponibilidade e nada é gravado.
          processMessage:
            processMessage ??
            (async () => {
              throw new AssistantUnavailableError('configuracao');
            }),
          telegram,
          clock,
          logger,
          // Registro pelo chat por regras: "gastei 45 no mercado" vira proposta com botões; a IA só entra
          // para o que as regras não entendem, e só se houver chave.
          capture: makeCaptureFlow({
            captures,
            tasks: taskUseCases,
            finance: financeUseCases,
            profiles,
            telegram,
            clock,
            logger,
            ...(config.miniAppUrl !== undefined ? { miniAppUrl: config.miniAppUrl } : {}),
          }),
          assistantEnabled: processMessage !== undefined,
          invites: inviteUseCases,
          acceptInvite,
          ...(qrLogin !== undefined ? { qrLogin } : {}),
          ...(config.miniAppUrl !== undefined ? { miniAppUrl: config.miniAppUrl } : {}),
          ...(config.telegramBotUsername !== undefined ? { botUsername: config.telegramBotUsername } : {}),
        })
      : undefined;

  // Login do Mini App pelo initData: só liga com o token do bot.
  const telegramLogin =
    config.telegramBotToken !== undefined
      ? makeTelegramLogin({
          botToken: config.telegramBotToken,
          maxAgeSeconds: config.telegramLoginMaxAgeSeconds ?? DEFAULT_TELEGRAM_LOGIN_MAX_AGE_SECONDS,
          replays: telegramAuth,
          links,
          sessions: sessionIssuer,
          ipLimiter: makeRateLimiter({ ...TELEGRAM_LOGIN_IP_LIMIT, clock }),
          userLimiter: makeRateLimiter({ ...TELEGRAM_LOGIN_USER_LIMIT, clock }),
          clock,
        })
      : undefined;

  return createApp({
    ...(telegramLogin !== undefined ? { telegramLogin } : {}),
    ...(qrLogin !== undefined ? { qrLogin } : {}),
    telegramLink,
    invites: inviteUseCases,
    ...(handleTelegramUpdate !== undefined ? { handleTelegramUpdate } : {}),
    ...(config.telegramWebhookSecret !== undefined ? { telegramWebhookSecret: config.telegramWebhookSecret } : {}),
    scheduler,
    ...(config.internalSecret !== undefined ? { internalSecret: config.internalSecret } : {}),
    verifyToken: createSupabaseAuthVerifier(supabase),
    tasks: taskUseCases,
    finance: financeUseCases,
    capture: makeCaptureInterpretUseCases({ profiles, clock }),
    settings: makeSettingsUseCases({
      profiles,
      tasks,
      syncReminders,
    }),
    briefing: getBriefing,
    webOrigin: config.webOrigin,
    ...(processMessage !== undefined ? { processMessage } : {}),
  });
}
