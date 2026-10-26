import { serve } from '@hono/node-server';
import { createClient } from '@supabase/supabase-js';
import { createApp } from './app.js';
import { makeCalculateDeadline } from './application/calculate-deadline.js';
import { makeTaskUseCases } from './application/tasks.js';
import { loadConfig } from './config.js';
import { createSupabaseAuthVerifier } from './infra/supabase-auth.js';
import { createSupabaseCaseRepository } from './infra/supabase-case-repository.js';
import { createSupabaseHolidayRepository } from './infra/supabase-holiday-repository.js';
import { createSupabaseProfileRepository } from './infra/supabase-profile-repository.js';
import { createSupabaseReminderRepository } from './infra/supabase-reminder-repository.js';
import { createSupabaseTaskRepository } from './infra/supabase-task-repository.js';

const config = loadConfig(process.env);
const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const calculateDeadline = makeCalculateDeadline({ holidays: createSupabaseHolidayRepository(client) });

const app = createApp({
  verifyToken: createSupabaseAuthVerifier(client),
  calculateDeadline,
  tasks: makeTaskUseCases({
    tasks: createSupabaseTaskRepository(client),
    cases: createSupabaseCaseRepository(client),
    profiles: createSupabaseProfileRepository(client),
    reminders: createSupabaseReminderRepository(client),
    calculateDeadline,
    clock: { now: () => new Date() },
  }),
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`API ouvindo na porta ${info.port}`);
});
