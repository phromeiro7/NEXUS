import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SchedulerResult } from '../application/scheduler.js';
import { buildApp, WEB_ORIGIN } from '../../test/harness.js';

const SECRET = 'TEST_SECRET_123';
const RESULT: SchedulerResult = {
  reminders: { sent: 3, retried: 1, failed: 0, cancelled: 2, recovered: 1, paused: 0, leaseLost: 0, deferred: 0 },
  briefings: { sent: 1, skippedEmpty: 0, retried: 0, failed: 0, paused: 0, deferred: 0 },
  eventsRecovered: { recovered: 1, failed: 0 },
  purged: { chatMessages: 4, linkCodes: 5, modelCalls: 6 },
};
const UNAUTH = { error: 'nao_autenticado' };

afterEach(() => vi.restoreAllMocks());

function setup(opts: { secret?: string | undefined; scheduler?: () => Promise<SchedulerResult> } = {}) {
  const calls = { n: 0 };
  const scheduler = opts.scheduler ?? (async () => (calls.n++, RESULT));
  const secret = 'secret' in opts ? opts.secret : SECRET;
  const { app } = buildApp({ scheduler, ...(secret !== undefined ? { internalSecret: secret } : {}) });
  return { app, calls };
}

const run = (app: ReturnType<typeof setup>['app'], headers: Record<string, string> = {}, init: RequestInit = {}) =>
  app.request('/internal/reminders/run', { method: 'POST', headers, ...init });

describe('POST /internal/reminders/run', () => {
  it('200 with the exact scheduler result when the secret matches', async () => {
    const { app, calls } = setup();
    const res = await run(app, { 'X-Internal-Secret': SECRET });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(RESULT);
    expect(calls.n).toBe(1);
  });

  it('ignores the request body', async () => {
    const { app, calls } = setup();
    const res = await run(app, { 'X-Internal-Secret': SECRET, 'Content-Type': 'application/json' }, { body: '{nao json' });
    expect(res.status).toBe(200);
    expect(calls.n).toBe(1);
  });

  const bad: Array<[string, Record<string, string>]> = [
    ['no header', {}],
    ['a wrong secret of the same length', { 'X-Internal-Secret': 'TEST_SECRET_124' }],
    ['a secret of a different length (shorter)', { 'X-Internal-Secret': 'x' }],
    ['a secret of a different length (longer)', { 'X-Internal-Secret': `${SECRET}${SECRET}` }],
    ['a prefix of the secret', { 'X-Internal-Secret': SECRET.slice(0, -1) }],
    ['an empty header', { 'X-Internal-Secret': '' }],
    ['a user bearer token instead', { Authorization: `Bearer ${SECRET}` }],
  ];
  it.each(bad)('401 with an identical, non-informative body for %s, and the scheduler does not run', async (_n, headers) => {
    const { app, calls } = setup();
    const res = await run(app, headers);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(JSON.stringify(UNAUTH));
    expect(calls.n).toBe(0);
  });

  it('503 agendador_desabilitado when no secret is configured, even with a header', async () => {
    const variants: Array<Record<string, string>> = [{},{ 'X-Internal-Secret': SECRET }, { 'X-Internal-Secret': '' }, { 'X-Internal-Secret': 'undefined' }];
    for (const headers of variants) {
      const { app, calls } = setup({ secret: undefined });
      const res = await run(app, headers);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'agendador_desabilitado' });
      expect(calls.n).toBe(0);
    }
  });

  it('an empty configured secret is treated as not configured (fail closed)', async () => {
    const { app, calls } = setup({ secret: '' });
    const res = await run(app, { 'X-Internal-Secret': '' });
    expect(res.status).toBe(503);
    expect(calls.n).toBe(0);
  });

  it('503 when the app has a secret but no scheduler', async () => {
    const { app } = buildApp({ internalSecret: SECRET });
    const res = await run(app, { 'X-Internal-Secret': SECRET });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'agendador_desabilitado' });
  });

  it('GET and other methods are not served (404/405) and never run the scheduler', async () => {
    const { app, calls } = setup();
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const res = await app.request('/internal/reminders/run', { method, headers: { 'X-Internal-Secret': SECRET } });
      expect([404, 405]).toContain(res.status);
    }
    expect(calls.n).toBe(0);
  });

  it('does not apply the user-auth middleware (no Authorization needed, verifier never consulted)', async () => {
    const { app } = setup();
    const res = await run(app, { 'X-Internal-Secret': SECRET });
    expect(res.status).toBe(200);
  });

  it('a scheduler that throws yields the generic 500 without the error text or the secret', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app } = setup({
      scheduler: async () => {
        throw new Error(`segredo ${SECRET} vazou`);
      },
    });
    const res = await run(app, { 'X-Internal-Secret': SECRET });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'erro_interno' });
    const logged = errSpy.mock.calls.flat().map((a) => (a instanceof Error ? `${a.name} ${a.message} ${a.stack}` : String(a)));
    expect(logged).toEqual(['[api] erro não tratado', 'Error']);
  });

  it('never leaks the secret in responses, headers or console output', async () => {
    const out = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'info')];
    for (const spy of out) spy.mockImplementation(() => undefined);
    const texts: string[] = [];
    for (const [secret, headers] of [
      [SECRET, { 'X-Internal-Secret': SECRET }],
      [SECRET, { 'X-Internal-Secret': 'TEST_SECRET_999' }],
      [SECRET, {}],
      [undefined, { 'X-Internal-Secret': SECRET }],
    ] as const) {
      const { app } = setup({ secret });
      const res = await run(app, headers);
      texts.push(await res.text(), JSON.stringify([...res.headers.entries()]));
    }
    expect(texts.join('\n')).not.toContain(SECRET);
    expect(texts.join('\n')).not.toContain('TEST_SECRET_999');
    expect(JSON.stringify(out.map((s) => s.mock.calls))).not.toContain('TEST_SECRET');
  });

  it('adds no CORS allowance for the internal route beyond the app default', async () => {
    const { app } = setup();
    const res = await run(app, { 'X-Internal-Secret': SECRET, Origin: 'https://evil.example' });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const own = await run(app, { 'X-Internal-Secret': SECRET, Origin: WEB_ORIGIN });
    expect(own.headers.get('access-control-allow-headers')).toBeNull(); // só preflight anuncia headers
    const pre = await app.request('/internal/reminders/run', {
      method: 'OPTIONS',
      headers: { Origin: WEB_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-internal-secret' },
    });
    expect(pre.headers.get('access-control-allow-headers') ?? '').not.toMatch(/x-internal-secret/i);
  });
});
