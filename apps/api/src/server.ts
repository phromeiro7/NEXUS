import { serve } from '@hono/node-server';
import { buildApp } from './compose.js';
import { loadConfig } from './config.js';

const config = loadConfig(process.env);
const app = buildApp(config);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`API ouvindo na porta ${info.port}`);
});
