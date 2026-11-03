import { createClient } from '@supabase/supabase-js';
import type { TaskDto } from '@aj/shared';
import { createApp } from './app.js';
import { makeProcessMessage } from './application/assistant/process-message.js';
import { makeToolExecutor } from './application/assistant/tools.js';
import { NotFoundError } from './application/errors.js';
import type { AssistantModel } from './application/ports.js';
import { createAnthropicAssistantModel } from './infra/anthropic-assistant-model.js';
import { createJsonLogger } from './infra/json-logger.js';
import { createSupabaseChatRepository } from './infra/supabase-chat-repository.js';
import { createSupabaseInboundEventRepository } from './infra/supabase-inbound-event-repository.js';
import { makeGetBriefing } from './application/briefing.js';
import { makeCalculateDeadline } from './application/calculate-deadline.js';
import { makeCaseUseCases } from './application/cases.js';
import { makeHolidayUseCases } from './application/holidays.js';
import type { Clock } from './application/ports.js';
import { makeSettingsUseCases } from './application/settings.js';
import { makeSyncReminders } from './application/sync-reminders.js';
import { makeTaskUseCases } from './application/tasks.js';
import type { Config } from './config.js';
import { createSupabaseAuthVerifier } from './infra/supabase-auth.js';
import { createSupabaseCaseRepository } from './infra/supabase-case-repository.js';
import { createSupabaseHolidayRepository } from './infra/supabase-holiday-repository.js';
import { createSupabaseProfileRepository } from './infra/supabase-profile-repository.js';
import { createSupabaseReminderRepository } from './infra/supabase-reminder-repository.js';
import { createSupabaseTaskRepository } from './infra/supabase-task-repository.js';

/**
 * Monta a API real (Supabase, repositórios e casos de uso). `clock` e `assistantModel` só são
 * sobrescritos em testes. Sem `assistantModel` nem `config.anthropicApiKey` o assistente fica
 * desabilitado (a rota responde 503 'configuracao') e o resto da API funciona normalmente.
 */
export function buildApp(
  config: Config,
  overrides?: { clock?: Clock; assistantModel?: AssistantModel },
): ReturnType<typeof createApp> {
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const holidays = createSupabaseHolidayRepository(client);
  const cases = createSupabaseCaseRepository(client);
  const profiles = createSupabaseProfileRepository(client);
  const reminders = createSupabaseReminderRepository(client);
  const tasks = createSupabaseTaskRepository(client);
  const clock: Clock = overrides?.clock ?? { now: () => new Date() };
  const calculateDeadline = makeCalculateDeadline({ holidays });
  const taskUseCases = makeTaskUseCases({ tasks, cases, profiles, reminders, calculateDeadline, clock });

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
          events: createSupabaseInboundEventRepository(client),
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

  return createApp({
    verifyToken: createSupabaseAuthVerifier(client),
    calculateDeadline,
    tasks: taskUseCases,
    cases: makeCaseUseCases({ cases }),
    holidays: makeHolidayUseCases({ holidays }),
    settings: makeSettingsUseCases({
      profiles,
      tasks,
      syncReminders: makeSyncReminders({ reminders, clock }),
    }),
    briefing: makeGetBriefing({ tasks, profiles, clock }),
    webOrigin: config.webOrigin,
    ...(processMessage !== undefined ? { processMessage } : {}),
  });
}
