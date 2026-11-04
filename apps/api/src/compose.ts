import { createClient } from '@supabase/supabase-js';
import type { TaskDto } from '@aj/shared';
import { createApp } from './app.js';
import { makeProcessMessage } from './application/assistant/process-message.js';
import { makeToolExecutor } from './application/assistant/tools.js';
import { AssistantUnavailableError, NotFoundError } from './application/errors.js';
import { makeLinkUseCases } from './application/telegram/link.js';
import { makeCaptureFlow } from './application/telegram/capture.js';
import { makeHandleTelegramUpdate } from './application/telegram/webhook.js';
import { createSupabaseCaptureRepository } from './infra/supabase-capture-repository.js';
import { createSupabaseConfirmationRepository } from './infra/supabase-confirmation-repository.js';
import { createSupabaseLinkRepository } from './infra/supabase-link-repository.js';
import { makeAcceptInvite, makeInviteUseCases } from './application/invites.js';
import { createSupabaseAccountProvisioner } from './infra/supabase-account-provisioner.js';
import { createSupabaseInviteRepository } from './infra/supabase-invite-repository.js';
import { makeTelegramLogin } from './application/telegram/login.js';
import { makeRateLimiter } from './application/telegram/rate-limit.js';
import { createSupabaseSessionIssuer, createSupabaseTelegramAuthRepository } from './infra/supabase-telegram-auth-repository.js';
import type { AssistantModel } from './application/ports.js';
import { createAnthropicAssistantModel } from './infra/anthropic-assistant-model.js';
import { createJsonLogger } from './infra/json-logger.js';
import { createSupabaseChatRepository } from './infra/supabase-chat-repository.js';
import { createSupabaseInboundEventRepository } from './infra/supabase-inbound-event-repository.js';
import { makeGetBriefing } from './application/briefing.js';
import { makeCalculateDeadline } from './application/calculate-deadline.js';
import { makeCaseUseCases } from './application/cases.js';
import { makeFinanceUseCases } from './application/finance.js';
import { makeHolidayUseCases } from './application/holidays.js';
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
import { createSupabaseCaseRepository } from './infra/supabase-case-repository.js';
import { createSupabaseFinanceRepository } from './infra/supabase-finance-repository.js';
import { createSupabaseHolidayRepository } from './infra/supabase-holiday-repository.js';
import { createSupabaseProfileRepository } from './infra/supabase-profile-repository.js';
import { createSupabaseReminderRepository } from './infra/supabase-reminder-repository.js';
import { createSupabaseTaskRepository } from './infra/supabase-task-repository.js';

/**
 * Monta a API real (Supabase, repositórios e casos de uso). `clock`, `assistantModel` e
 * `telegramClient` só são sobrescritos em testes. Sem `assistantModel` nem `config.anthropicApiKey` o assistente fica
 * desabilitado (a rota responde 503 'configuracao') e o resto da API funciona normalmente.
 */
export function buildApp(
  config: Config,
  overrides?: { clock?: Clock; assistantModel?: AssistantModel; telegramClient?: TelegramClient },
): ReturnType<typeof createApp> {
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const holidays = createSupabaseHolidayRepository(client);
  const finance = createSupabaseFinanceRepository(client);
  const cases = createSupabaseCaseRepository(client);
  const profiles = createSupabaseProfileRepository(client);
  const reminders = createSupabaseReminderRepository(client);
  const tasks = createSupabaseTaskRepository(client);
  const clock: Clock = overrides?.clock ?? { now: () => new Date() };
  const calculateDeadline = makeCalculateDeadline({ holidays });
  const taskUseCases = makeTaskUseCases({ tasks, cases, profiles, reminders, calculateDeadline, clock });

  const events = createSupabaseInboundEventRepository(client);
  const model: AssistantModel | undefined =
    overrides?.assistantModel ??
    (config.anthropicApiKey !== undefined
      ? createAnthropicAssistantModel({ apiKey: config.anthropicApiKey, model: config.assistantModel })
      : undefined);
  const processMessage =
    model === undefined
      ? undefined
      : makeProcessMessage({
          model,
          executor: makeToolExecutor({ tasks: taskUseCases, calculateDeadline, profiles, clock }),
          chat: createSupabaseChatRepository(client),
          events,
          profiles,
          clock,
          tasksByIds: async (userId, ids) => {
            const found: TaskDto[] = [];
            for (const id of ids) {
              try {
                found.push(await taskUseCases.get(userId, id));
              } catch (error) {
                if (!(error instanceof NotFoundError)) throw error;
              }
            }
            return found;
          },
          logger: createJsonLogger(),
        });

  // Telegram: cliente real só com token (ou o falso de teste). Sem ele o agendador ainda recupera,
  // cancela e limpa, mas nunca reserva nem envia (Ruling 13).
  const telegram: TelegramClient | undefined =
    overrides?.telegramClient ??
    (config.telegramBotToken !== undefined ? createTelegramClient({ token: config.telegramBotToken }) : undefined);
  const logger = createJsonLogger();
  const queue = createSupabaseReminderQueue(client);
  const syncReminders = makeSyncReminders({ reminders, clock });
  const getBriefing = makeGetBriefing({ tasks, profiles, clock });
  const runReminders = makeRunReminders({
    queue,
    ...(telegram !== undefined ? { telegram } : {}),
    tasks,
    profiles,
    syncReminders,
    clock,
    logger,
  });
  const sendDailyBriefings = makeSendDailyBriefings({
    briefings: createSupabaseBriefingRepository(client, { logger }),
    getBriefing,
    ...(telegram !== undefined ? { telegram } : {}),
    queue,
    clock,
    logger,
    budgetMs: SCHEDULER_BUDGETS_MS.briefings,
  });
  const captures = createSupabaseCaptureRepository(client);
  const financeUseCases = makeFinanceUseCases({ finance, clock });
  const telegramAuth = createSupabaseTelegramAuthRepository(client);
  const scheduler = makeRunScheduler({
    maintenance: createSupabaseMaintenanceRepository(client),
    purgeCaptures: (at) => captures.purgeExpired(at),
    purgeTelegramAuth: (at) => telegramAuth.purgeExpired(at),
    runReminders: () => runReminders({ budgetMs: SCHEDULER_BUDGETS_MS.reminders }),
    sendDailyBriefings,
    clock,
    logger,
  });

  // Vínculo e webhook do Telegram. O webhook só existe com cliente do Telegram E segredo configurados;
  // sem eles a rota responde 503 'webhook_desabilitado' e o resto da API funciona.
  const links = createSupabaseLinkRepository(client);
  // Convites: administradores vêm de ADMIN_TELEGRAM_USER_IDS; sem token do bot não há link para compartilhar.
  const inviteUseCases = makeInviteUseCases({
    invites: createSupabaseInviteRepository(client),
    adminTelegramIds: new Set(config.adminTelegramUserIds ?? []),
    botUsername: config.telegramBotUsername,
    ...(config.inviteTtlDays !== undefined ? { ttlDays: config.inviteTtlDays } : {}),
    clock,
  });
  const acceptInvite = makeAcceptInvite({
    invites: createSupabaseInviteRepository(client),
    accounts: createSupabaseAccountProvisioner(client),
    links,
    clock,
  });
  const telegramLink = makeLinkUseCases({ links, botUsername: config.telegramBotUsername, clock });
  const handleTelegramUpdate =
    telegram !== undefined && config.telegramWebhookSecret !== undefined
      ? makeHandleTelegramUpdate({
          links,
          events,
          confirmations: createSupabaseConfirmationRepository(client),
          // Sem modelo (sem chave): o usuário recebe o aviso de indisponibilidade e nada é gravado.
          processMessage:
            processMessage ??
            (async () => {
              throw new AssistantUnavailableError('configuracao');
            }),
          telegram,
          clock,
          logger,
          // Registro pelo chat por regras: "gastei 100 em roupa" vira proposta com botões; a IA só entra
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
          ...(config.miniAppUrl !== undefined ? { miniAppUrl: config.miniAppUrl } : {}),
          ...(config.telegramBotUsername !== undefined ? { botUsername: config.telegramBotUsername } : {}),
        })
      : undefined;

  // Login do Mini App pelo initData: só liga com o token do bot. O limite por IP é folgado (vários
  // aparelhos atrás do mesmo NAT); o por usuário do Telegram é curto.
  const telegramLogin =
    config.telegramBotToken !== undefined
      ? makeTelegramLogin({
          botToken: config.telegramBotToken,
          maxAgeSeconds: config.telegramLoginMaxAgeSeconds ?? 3600,
          replays: telegramAuth,
          links,
          sessions: createSupabaseSessionIssuer(client),
          ipLimiter: makeRateLimiter({ max: 30, windowMs: 10 * 60_000, clock }),
          userLimiter: makeRateLimiter({ max: 10, windowMs: 10 * 60_000, clock }),
          clock,
        })
      : undefined;

  return createApp({
    ...(telegramLogin !== undefined ? { telegramLogin } : {}),
    telegramLink,
    invites: inviteUseCases,
    ...(handleTelegramUpdate !== undefined ? { handleTelegramUpdate } : {}),
    ...(config.telegramWebhookSecret !== undefined ? { telegramWebhookSecret: config.telegramWebhookSecret } : {}),
    scheduler,
    ...(config.internalSecret !== undefined ? { internalSecret: config.internalSecret } : {}),
    verifyToken: createSupabaseAuthVerifier(client),
    calculateDeadline,
    tasks: taskUseCases,
    cases: makeCaseUseCases({ cases }),
    holidays: makeHolidayUseCases({ holidays }),
    finance: financeUseCases,
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
