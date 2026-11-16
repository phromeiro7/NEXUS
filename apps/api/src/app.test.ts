import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { buildApp, WEB_ORIGIN } from '../test/harness.js';

function build(opts: { explode?: boolean; verifierThrows?: boolean } = {}) {
  const { app } = buildApp({
    verifierThrows: opts.verifierThrows,
    ...(opts.explode
      ? {
          tasksOverride: {
            list: async () => {
              throw new Error('segredo interno: db password');
            },
          },
        }
      : {}),
  });
  return { app };
}

const auth = { Authorization: 'Bearer token-ok', 'Content-Type': 'application/json' };
const listTasks = (app: ReturnType<typeof build>['app']) => app.request('/tasks', { headers: auth });

describe('app', () => {
  it('GET /health is public', async () => {
    const res = await build().app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /me without token is 401', async () => {
    const res = await build().app.request('/me');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'nao_autenticado' });
  });

  it('GET /me with valid token returns userId', async () => {
    const res = await build().app.request('/me', { headers: { Authorization: 'Bearer token-ok' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'u1' });
  });

  it.each(['token-ok', 'Basic token-ok', 'Bearer', 'Bearer '])('rejects malformed Authorization %j', async (h) => {
    const res = await build().app.request('/me', { headers: { Authorization: h } });
    expect(res.status).toBe(401);
  });

  it('rejects a token the verifier does not accept', async () => {
    const res = await build().app.request('/me', { headers: { Authorization: 'Bearer outro' } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'nao_autenticado' });
  });

  it('hides internals on unexpected errors', async () => {
    const res = await listTasks(build({ explode: true }).app);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'erro_interno' });
    expect(text).not.toContain('segredo');
  });

  describe('unhandled errors', () => {
    let errorSpy: MockInstance<typeof console.error>;
    beforeEach(() => {
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
      errorSpy.mockRestore();
    });

    it('logs the error once server-side, without the token, and returns a generic 500', async () => {
      const res = await listTasks(build({ explode: true }).app);
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: 'erro_interno' });
      expect(text).not.toContain('segredo interno: db password');

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const args = errorSpy.mock.calls[0]!;
      expect(args).toContainEqual(expect.objectContaining({ message: 'segredo interno: db password' }));
      expect(args.some((a) => a instanceof Error)).toBe(true);
      const logged = args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : String(a))).join(' ');
      expect(logged).not.toContain('token-ok');
    });

    it('a verifier that throws yields 500 erro_interno, not 401', async () => {
      const res = await build({ verifierThrows: true }).app.request('/me', {
        headers: { Authorization: 'Bearer token-ok' },
      });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'erro_interno' });
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('CORS', () => {
    const preflight = (origin: string) =>
      build().app.request('/tasks', {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      });

    it('preflight from the allowed origin is 204 with the origin echoed, without a token', async () => {
      const res = await preflight(WEB_ORIGIN);
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
      expect(res.headers.get('access-control-allow-methods')).toBe('GET,POST,PATCH,DELETE,OPTIONS');
      // X-Poll-Secret: o navegador do login por QR prova que é dono do pedido; maxAge poupa um preflight por consulta.
      expect(res.headers.get('access-control-allow-headers')).toBe('Authorization,Content-Type,X-Poll-Secret');
      expect(res.headers.get('access-control-max-age')).toBe('600');
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    });

    it('preflight from another origin gets no access-control-allow-origin', async () => {
      const res = await preflight('https://evil.example');
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('an authenticated GET from the allowed origin carries the header; from another origin it does not', async () => {
      const { app } = build();
      const ok = await app.request('/tasks', { headers: { ...auth, Origin: WEB_ORIGIN } });
      expect(ok.status).toBe(200);
      expect(ok.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
      const other = await app.request('/tasks', { headers: { ...auth, Origin: 'https://evil.example' } });
      expect(other.status).toBe(200);
      expect(other.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('CORS does not bypass auth: an unauthenticated normal request is still 401', async () => {
      const res = await build().app.request('/tasks', { headers: { Origin: WEB_ORIGIN } });
      expect(res.status).toBe(401);
    });
  });

  describe('body limit (64 KB)', () => {
    // ~70 KB de JSON válido, acima do limite.
    const bigBody = JSON.stringify({ title: 'Grande', notes: 'x'.repeat(70 * 1024) });

    it('a 70 KB body to POST /tasks with a valid token is 413 corpo_muito_grande and creates nothing', async () => {
      const { app, fakes } = buildApp();
      expect(bigBody.length).toBeGreaterThan(64 * 1024);
      const res = await app.request('/tasks', { method: 'POST', headers: auth, body: bigBody });
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: 'corpo_muito_grande' });
      expect(await fakes.tasks.list('u1', {})).toEqual([]);
    });

    it('the limit runs before auth: the same body without a token is 413, not 401', async () => {
      const { app, fakes } = buildApp();
      const res = await app.request('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bigBody,
      });
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: 'corpo_muito_grande' });
      expect(await fakes.tasks.list('u1', {})).toEqual([]);
    });

    it('a normal-size body still works', async () => {
      const { app, fakes } = buildApp();
      const res = await app.request('/tasks', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ title: 'Pequena', dueDate: '2026-10-30' }),
      });
      expect(res.status).toBe(201);
      expect((await fakes.tasks.list('u1', {})).map((t) => t.title)).toEqual(['Pequena']);
    });

    it('GET requests are unaffected', async () => {
      const res = await build().app.request('/tasks', { headers: auth });
      expect(res.status).toBe(200);
    });

    it('a preflight is unaffected', async () => {
      const res = await build().app.request('/tasks', {
        method: 'OPTIONS',
        headers: {
          Origin: WEB_ORIGIN,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    });
  });

  describe('notFound', () => {
    it('an unknown path returns JSON 404 with and without a token', async () => {
      const { app } = build();
      for (const headers of [{}, auth]) {
        const res = await app.request('/nao-existe', { headers });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'nao_encontrado' });
      }
    });

    it('an unknown /tasks sub-path stays behind auth', async () => {
      const { app } = build();
      const anon = await app.request('/tasks/a/b/c');
      expect(anon.status).toBe(401);
      const logged = await app.request('/tasks/a/b/c', { headers: auth });
      expect(logged.status).toBe(404);
      expect(await logged.json()).toEqual({ error: 'nao_encontrado' });
    });
  });
});
