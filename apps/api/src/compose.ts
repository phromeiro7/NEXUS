import { createClient } from '@supabase/supabase-js';
import { createApp } from './app.js';
import { makeGetBriefing } from './application/briefing.js';
import { makeCalculateDeadline } from './application/calculate-deadline.js';
import { makeCaseUseCases } from './application/cases.js';
import { makeFinanceUseCases } from './application/finance.js';
import { makeHolidayUseCases } from './application/holidays.js';
import type { Clock } from './application/ports.js';
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

/** Monta a API real (Supabase, repositórios e casos de uso). `clock` só é sobrescrito em testes. */
export function buildApp(config: Config, overrides?: { clock?: Clock }): ReturnType<typeof createApp> {
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

  return createApp({
    verifyToken: createSupabaseAuthVerifier(client),
    calculateDeadline,
    tasks: makeTaskUseCases({ tasks, cases, profiles, reminders, calculateDeadline, clock }),
    cases: makeCaseUseCases({ cases }),
    holidays: makeHolidayUseCases({ holidays }),
    finance: makeFinanceUseCases({ finance, clock }),
    settings: makeSettingsUseCases({
      profiles,
      tasks,
      syncReminders: makeSyncReminders({ reminders, clock }),
    }),
    briefing: makeGetBriefing({ tasks, profiles, clock }),
    webOrigin: config.webOrigin,
  });
}
