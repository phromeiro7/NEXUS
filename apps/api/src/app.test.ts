import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { Holiday, IsoDate } from '@aj/shared';
import { createApp } from './app.js';
import { makeCalculateDeadline } from './application/calculate-deadline.js';
import type { HolidayRepository } from './application/ports.js';
import { makeTaskUseCases } from './application/tasks.js';
import { createFakes } from '../test/fakes.js';

function build(opts: { rows?: Holiday[]; explode?: boolean; verifierThrows?: boolean } = {}) {
  const seen: string[] = [];
  const holidays: HolidayRepository = {
    async listByUser(userId, from, to) {
      seen.push(userId);
      if (opts.explode) throw new Error('segredo interno: db password');
      return (opts.rows ?? []).filter((h) => h.date >= from && h.date <= to);
    },
  };
  const fakes = createFakes();
  const calculateDeadline = makeCalculateDeadline({ holidays });
  const app = createApp({
    verifyToken: async (t) => {
      if (opts.verifierThrows) throw new Error('auth provider fora do ar');
      return t === 'token-ok' ? { userId: 'u1' } : null;
    },
    calculateDeadline,
    tasks: makeTaskUseCases({
      tasks: fakes.tasks,
      cases: fakes.cases,
      profiles: fakes.profiles,
      reminders: fakes.reminders,
      calculateDeadline,
      clock: fakes.clock,
    }),
  });
  return { app, seen };
}

const auth = { Authorization: 'Bearer token-ok', 'Content-Type': 'application/json' };
const post = (app: ReturnType<typeof build>['app'], body: string, headers: Record<string, string> = auth) =>
  app.request('/deadlines/calculate', { method: 'POST', headers, body });
const valid = { baseDate: '2026-10-26', days: 15, countType: 'uteis' };

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

  it('POST /deadlines/calculate requires auth', async () => {
    const res = await post(build().app, JSON.stringify(valid), { 'Content-Type': 'application/json' });
    expect(res.status).toBe(401);
  });

  it('calculates a deadline', async () => {
    const res = await post(build().app, JSON.stringify(valid));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dueDate: IsoDate; feriadosDescontados: Holiday[] };
    expect(body.dueDate).toBe('2026-11-17');
    expect(body.feriadosDescontados).toContainEqual({ date: '2026-11-02', name: 'Finados' });
  });

  it('rejects days=0', async () => {
    const res = await post(build().app, JSON.stringify({ ...valid, days: 0 }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown };
    expect(body.error).toBe('entrada_invalida');
    expect(body.issues).toBeDefined();
  });

  it('rejects a calendar-invalid date', async () => {
    const res = await post(build().app, JSON.stringify({ ...valid, baseDate: '2026-02-31' }));
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const res = await post(build().app, '{nope');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'entrada_invalida' });
  });

  it('takes userId only from the verified token', async () => {
    const { app, seen } = build();
    const res = await post(app, JSON.stringify({ ...valid, userId: 'atacante' }));
    expect(res.status).toBe(200);
    expect(seen).toEqual(['u1']);
  });

  it('hides internals on unexpected errors', async () => {
    const res = await post(build({ explode: true }).app, JSON.stringify(valid));
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
      const res = await post(build({ explode: true }).app, JSON.stringify(valid));
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
});
