import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import {
  calculateDeadlineInputSchema,
  type BriefingDto,
  type CalculateDeadlineResultDto,
  type MeDto,
} from '@aj/shared';
import { authMiddleware, type AuthVerifier } from './auth.js';
import type { makeCalculateDeadline } from './application/calculate-deadline.js';
import type { makeCaseUseCases } from './application/cases.js';
import type { makeHolidayUseCases } from './application/holidays.js';
import type { makeSettingsUseCases } from './application/settings.js';
import type { makeTaskUseCases } from './application/tasks.js';
import { errorResponse } from './http-errors.js';
import { assistantRoutes, type ProcessMessage } from './routes/assistant.js';
import { briefingRoutes } from './routes/briefing.js';
import { casesRoutes } from './routes/cases.js';
import { holidaysRoutes } from './routes/holidays.js';
import { settingsRoutes } from './routes/settings.js';
import { tasksRoutes } from './routes/tasks.js';

export type AppDeps = {
  verifyToken: AuthVerifier;
  calculateDeadline: ReturnType<typeof makeCalculateDeadline>;
  tasks: ReturnType<typeof makeTaskUseCases>;
  cases: ReturnType<typeof makeCaseUseCases>;
  holidays: ReturnType<typeof makeHolidayUseCases>;
  settings: ReturnType<typeof makeSettingsUseCases>;
  briefing: (userId: string) => Promise<BriefingDto>;
  /** Única origem de navegador autorizada por CORS (o painel). */
  webOrigin: string;
  /** Ausente = assistente desabilitado: a rota responde 503 'configuracao'. */
  processMessage?: ProcessMessage;
};

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();

  // CORS no app pai, antes de qualquer rota: o preflight é respondido antes da autenticação por rota.
  // O Hono instalado já compara uma `origin` string com a origem da requisição; a forma de função é
  // mantida porque deixa a lista de permissão explícita e independente da versão do Hono.
  // `deps.webOrigin` já vem normalizada por `loadConfig` (sem barra final nem caminho).
  app.use(
    '*',
    cors({
      origin: (origin) => (origin === deps.webOrigin ? origin : null),
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  // Limite de corpo depois do CORS e antes de qualquer rota: roda antes da autenticação e da leitura do corpo.
  app.use(
    '*',
    bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'corpo_muito_grande' }, 413) }),
  );

  app.notFound((c) => c.json({ error: 'nao_encontrado' }, 404));

  app.onError((err, c) => {
    const { status, body, headers } = errorResponse(err);
    // Só o erro inesperado é logado: nunca headers, token ou config. O cliente recebe a resposta genérica.
    // No assistente a mensagem do erro pode carregar texto do usuário: só o nome do erro é registrado.
    if (status === 500) {
      if (c.req.path.startsWith('/assistant')) {
        console.error('[api] erro não tratado', err instanceof Error ? err.name : 'desconhecido');
      } else {
        console.error('[api] erro não tratado', err);
      }
    }
    for (const [name, value] of Object.entries(headers ?? {})) c.header(name, value);
    return c.json(body as object, status);
  });

  app.get('/health', (c) => c.json({ status: 'ok' }));

  const auth = authMiddleware(deps.verifyToken);

  app.get('/me', auth, (c) => {
    const me: MeDto = { userId: c.get('userId') };
    return c.json(me);
  });

  app.post('/deadlines/calculate', auth, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'entrada_invalida' }, 400);
    }
    const parsed = calculateDeadlineInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'entrada_invalida', issues: parsed.error.issues }, 400);
    }
    // userId vem só do token verificado, nunca do corpo.
    const result: CalculateDeadlineResultDto = await deps.calculateDeadline(c.get('userId'), parsed.data);
    return c.json(result);
  });

  app.route('/tasks', tasksRoutes({ tasks: deps.tasks }, auth));
  app.route('/cases', casesRoutes({ cases: deps.cases }, auth));
  app.route('/holidays', holidaysRoutes({ holidays: deps.holidays }, auth));
  app.route('/settings', settingsRoutes({ settings: deps.settings }, auth));
  app.route('/briefing', briefingRoutes({ briefing: deps.briefing }, auth));
  app.route('/assistant', assistantRoutes({ processMessage: deps.processMessage }, auth));

  return app;
}
