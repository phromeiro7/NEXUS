import { type AppDeps, createApp } from '../src/app.js';
import { makeCalculateDeadline } from '../src/application/calculate-deadline.js';
import { makeGetBriefing } from '../src/application/briefing.js';
import { makeCaseUseCases } from '../src/application/cases.js';
import { makeHolidayUseCases } from '../src/application/holidays.js';
import type { HolidayRepository, NewTask } from '../src/application/ports.js';
import { makeSettingsUseCases } from '../src/application/settings.js';
import { makeSyncReminders } from '../src/application/sync-reminders.js';
import { makeTaskUseCases } from '../src/application/tasks.js';
import { createFakes } from './fakes.js';

export const WEB_ORIGIN = 'http://localhost:3000';

export type HarnessOpts = {
  /** Repositório de feriados usado só pelo cálculo de prazo (padrão: o fake). */
  calcHolidays?: HolidayRepository;
  verifierThrows?: boolean;
  tasksOverride?: Partial<ReturnType<typeof makeTaskUseCases>>;
  casesOverride?: Partial<ReturnType<typeof makeCaseUseCases>>;
  holidaysOverride?: Partial<ReturnType<typeof makeHolidayUseCases>>;
  now?: Date;
  /** `processMessage` falso para as rotas do assistente (ausente = assistente desabilitado). */
  processMessage?: AppDeps['processMessage'];
  scheduler?: AppDeps['scheduler'];
  internalSecret?: AppDeps['internalSecret'];
};

/** App real sobre casos de uso reais e repositórios fake. Tokens: token-ok -> u1, token-u2 -> u2. */
export function buildApp(opts: HarnessOpts = {}) {
  const fakes = createFakes(opts.now ? { now: opts.now } : {});
  const calculateDeadline = makeCalculateDeadline({ holidays: opts.calcHolidays ?? fakes.holidays });
  const tasks = {
    ...makeTaskUseCases({
      tasks: fakes.tasks,
      cases: fakes.cases,
      profiles: fakes.profiles,
      reminders: fakes.reminders,
      calculateDeadline,
      clock: fakes.clock,
    }),
    ...opts.tasksOverride,
  };
  const app = createApp({
    verifyToken: async (t) => {
      if (opts.verifierThrows) throw new Error('auth provider fora do ar');
      if (t === 'token-ok') return { userId: 'u1' };
      if (t === 'token-u2') return { userId: 'u2' };
      return null;
    },
    calculateDeadline,
    tasks,
    cases: { ...makeCaseUseCases({ cases: fakes.cases }), ...opts.casesOverride },
    holidays: { ...makeHolidayUseCases({ holidays: fakes.holidays }), ...opts.holidaysOverride },
    settings: makeSettingsUseCases({
      profiles: fakes.profiles,
      tasks: fakes.tasks,
      syncReminders: makeSyncReminders({ reminders: fakes.reminders, clock: fakes.clock }),
    }),
    briefing: makeGetBriefing({ tasks: fakes.tasks, profiles: fakes.profiles, clock: fakes.clock }),
    webOrigin: WEB_ORIGIN,
    ...(opts.processMessage !== undefined ? { processMessage: opts.processMessage } : {}),
    ...(opts.scheduler !== undefined ? { scheduler: opts.scheduler } : {}),
    ...(opts.internalSecret !== undefined ? { internalSecret: opts.internalSecret } : {}),
  });
  return { app, fakes };
}

export type TestApp = ReturnType<typeof buildApp>['app'];

export const headers = (token = 'token-ok') => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

export const req = (app: TestApp, method: string, path: string, body?: unknown, token = 'token-ok') =>
  app.request(path, {
    method,
    headers: headers(token),
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

/** Chamada sem token, com o corpo dado (prova que a autenticação vem antes da validação). */
export const anon = (app: TestApp, method: string, path: string, body?: string) =>
  app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body });

export const newTask = (title: string, p: Partial<NewTask> = {}): NewTask => ({
  caseId: null,
  title,
  type: 'tarefa',
  status: 'pendente',
  dueDate: null,
  dueTime: null,
  fatal: false,
  baseDate: null,
  periodDays: null,
  countType: null,
  completedAt: null,
  source: 'painel',
  sourceText: null,
  ...p,
});
