import { Hono } from 'hono';
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
};

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();

  // CORS no app pai, antes de qualquer rota: o preflight é respondido antes da autenticação por rota.
  // `origin` como função: só devolve a origem quando é exatamente a permitida (uma string fixa seria enviada a qualquer origem).
  app.use(
    '*',
    cors({
      origin: (origin) => (origin === deps.webOrigin ? origin : null),
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  app.notFound((c) => c.json({ error: 'nao_encontrado' }, 404));

  app.onError((err, c) => {
    const { status, body } = errorResponse(err);
    // Só o erro inesperado é logado: nunca headers, token ou config. O cliente recebe a resposta genérica.
    if (status === 500) console.error('[api] erro não tratado', err);
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

  return app;
}
