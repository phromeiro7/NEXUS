import { serve } from '@hono/node-server';
import { createClient } from '@supabase/supabase-js';
import { createApp } from './app.js';
import { makeCalculateDeadline } from './application/calculate-deadline.js';
import { loadConfig } from './config.js';
import { createSupabaseAuthVerifier } from './infra/supabase-auth.js';
import { createSupabaseHolidayRepository } from './infra/supabase-holiday-repository.js';

const config = loadConfig(process.env);
const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = createApp({
  verifyToken: createSupabaseAuthVerifier(client),
  calculateDeadline: makeCalculateDeadline({ holidays: createSupabaseHolidayRepository(client) }),
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`API ouvindo na porta ${info.port}`);
});
