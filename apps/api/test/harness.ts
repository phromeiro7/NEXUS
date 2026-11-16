import { type AppDeps, createApp } from '../src/app.js';
import { makeGetBriefing } from '../src/application/briefing.js';
import { makeCaptureInterpretUseCases } from '../src/application/capture-interpret.js';
import { makeFinanceUseCases } from '../src/application/finance.js';
import type { NewTask } from '../src/application/ports.js';
import { makeSettingsUseCases } from '../src/application/settings.js';
import { makeSyncReminders } from '../src/application/sync-reminders.js';
import { makeTaskUseCases } from '../src/application/tasks.js';
import { makeInviteUseCases } from '../src/application/invites.js';
import { makeLinkUseCases } from '../src/application/telegram/link.js';
import { createFakes } from './fakes.js';

export const WEB_ORIGIN = 'http://localhost:3000';

export type HarnessOpts = {
  verifierThrows?: boolean;
  tasksOverride?: Partial<ReturnType<typeof makeTaskUseCases>>;
  now?: Date;
  /** `processMessage` falso para as rotas do assistente (ausente = assistente desabilitado). */
  processMessage?: AppDeps['processMessage'];
  scheduler?: AppDeps['scheduler'];
  internalSecret?: AppDeps['internalSecret'];
  handleTelegramUpdate?: AppDeps['handleTelegramUpdate'];
  telegramWebhookSecret?: AppDeps['telegramWebhookSecret'];
  telegramLogin?: AppDeps['telegramLogin'];
  /** Login do painel por QR: o objeto pronto, ou uma função que monta o real sobre os fakes do harness. */
  qrLogin?: AppDeps['qrLogin'] | ((fakes: ReturnType<typeof createFakes>) => AppDeps['qrLogin']);
  /** Liga as rotas de convite: u1 ganha o chat 111 e `adminIds` diz quem administra (ausente = rotas fechadas). */
  invites?: { adminIds: number[] };
  /** Padrão 'meu_bot'; `null` = sem nome de bot (vínculo indisponível). */
  botUsername?: string | null;
};

/** App real sobre casos de uso reais e repositórios fake. Tokens: token-ok -> u1, token-u2 -> u2. */
export function buildApp(opts: HarnessOpts = {}) {
  const fakes = createFakes(opts.now ? { now: opts.now } : {});
  const tasks = {
    ...makeTaskUseCases({
      tasks: fakes.tasks,
      profiles: fakes.profiles,
      reminders: fakes.reminders,
      clock: fakes.clock,
    }),
    ...opts.tasksOverride,
  };
  if (opts.invites !== undefined) {
    fakes.links.setChat('u1', 111);
    fakes.links.setChat('u2', 222);
  }
  const app = createApp({
    verifyToken: async (t) => {
      if (opts.verifierThrows) throw new Error('auth provider fora do ar');
      if (t === 'token-ok') return { userId: 'u1' };
      if (t === 'token-u2') return { userId: 'u2' };
      return null;
    },
    tasks,
    finance: makeFinanceUseCases({ finance: fakes.finance, clock: fakes.clock }),
    capture: makeCaptureInterpretUseCases({ profiles: fakes.profiles, clock: fakes.clock }),
    settings: makeSettingsUseCases({
      profiles: fakes.profiles,
      tasks: fakes.tasks,
      syncReminders: makeSyncReminders({ reminders: fakes.reminders, clock: fakes.clock }),
    }),
    briefing: makeGetBriefing({ tasks: fakes.tasks, profiles: fakes.profiles, clock: fakes.clock }),
    webOrigin: WEB_ORIGIN,
    telegramLink: makeLinkUseCases({
      links: fakes.links,
      botUsername: opts.botUsername === null ? undefined : (opts.botUsername ?? 'meu_bot'),
      clock: fakes.clock,
    }),
    ...(opts.invites !== undefined
      ? {
          invites: makeInviteUseCases({
            invites: fakes.invites,
            accounts: fakes.accounts,
            adminTelegramIds: new Set(opts.invites.adminIds),
            botUsername: 'meu_bot',
            clock: fakes.clock,
          }),
        }
      : {}),
    ...(opts.telegramLogin !== undefined ? { telegramLogin: opts.telegramLogin } : {}),
    ...(opts.qrLogin !== undefined
      ? { qrLogin: typeof opts.qrLogin === 'function' ? opts.qrLogin(fakes) : opts.qrLogin }
      : {}),
    ...(opts.handleTelegramUpdate !== undefined ? { handleTelegramUpdate: opts.handleTelegramUpdate } : {}),
    ...(opts.telegramWebhookSecret !== undefined ? { telegramWebhookSecret: opts.telegramWebhookSecret } : {}),
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
  title,
  type: 'tarefa',
  status: 'pendente',
  dueDate: null,
  dueTime: null,
  fatal: false,
  completedAt: null,
  source: 'painel',
  sourceText: null,
  ...p,
});
