import { describe, expect, it, vi } from 'vitest';
import { TelegramAuthError } from '../application/errors.js';
import { buildApp, WEB_ORIGIN } from '../../test/harness.js';

const post = (app: ReturnType<typeof buildApp>['app'], body: unknown, headers: Record<string, string> = {}) =>
  app.request('/auth/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('POST /auth/telegram', () => {
  it('devolve o tokenHash, sem cache, e NÃO exige Bearer', async () => {
    const telegramLogin = vi.fn(async () => ({ tokenHash: 'abc' }));
    const { app } = buildApp({ telegramLogin });
    const res = await post(app, { initData: 'a=b&hash=c' }, { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ tokenHash: 'abc' });
    expect(telegramLogin).toHaveBeenCalledWith({ initData: 'a=b&hash=c', ip: '203.0.113.9' });
  });

  it('prefere o IP do Cloudflare e cai em "desconhecido" sem cabeçalho', async () => {
    const telegramLogin = vi.fn(async () => ({ tokenHash: 'x' }));
    const { app } = buildApp({ telegramLogin });
    await post(app, { initData: 'k' }, { 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '1.1.1.1' });
    await post(app, { initData: 'k' });
    expect(telegramLogin.mock.calls.map((c) => (c as unknown as [{ ip: string }])[0].ip)).toEqual(['198.51.100.7', 'desconhecido']);
  });

  it('desligado sem login configurado: 503 login_desabilitado', async () => {
    const { app } = buildApp();
    const res = await post(app, { initData: 'k' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'login_desabilitado' });
  });

  it.each([
    ['assinatura_invalida', 401],
    ['sessao_expirada', 401],
    ['ja_utilizado', 401],
    ['telegram_nao_vinculado', 403],
  ] as const)('%s vira %i com o código no corpo', async (code, status) => {
    const { app } = buildApp({
      telegramLogin: async () => {
        throw new TelegramAuthError(code);
      },
    });
    const res = await post(app, { initData: 'k' });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code });
  });

  it('muitas tentativas: 429 com Retry-After', async () => {
    const { app } = buildApp({
      telegramLogin: async () => {
        throw new TelegramAuthError('muitas_tentativas', 42);
      },
    });
    const res = await post(app, { initData: 'k' });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect(await res.json()).toEqual({ error: 'muitas_tentativas', retryAfterSeconds: 42 });
  });

  it.each([['não é json'], [{}], [{ initData: '' }], [{ initData: 42 }], [{ initData: 'k', userId: 'outro' }]])(
    'corpo inválido %j: 400 sem chamar o login',
    async (body) => {
      const telegramLogin = vi.fn(async () => ({ tokenHash: 'x' }));
      const { app } = buildApp({ telegramLogin });
      const res = await post(app, body);
      expect(res.status).toBe(400);
      expect(telegramLogin).not.toHaveBeenCalled();
    },
  );

  it('recusa initData grande demais (limite do corpo e do campo)', async () => {
    const { app } = buildApp({ telegramLogin: async () => ({ tokenHash: 'x' }) });
    expect((await post(app, { initData: 'a'.repeat(5000) })).status).toBe(400);
    expect((await post(app, { initData: 'a'.repeat(70_000) })).status).toBe(413);
  });

  it('erro inesperado é 500 genérico e não vaza o initData', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app } = buildApp({
      telegramLogin: async () => {
        throw new Error('falhou com initData=SEGREDO e token 123:ABC');
      },
    });
    const res = await post(app, { initData: 'SEGREDO' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'erro_interno' });
    expect(JSON.stringify(spy.mock.calls)).not.toContain('SEGREDO');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('123:ABC');
    spy.mockRestore();
  });

  it('o preflight do CORS libera o painel (e só ele)', async () => {
    const { app } = buildApp();
    const ok = await app.request('/auth/telegram', {
      method: 'OPTIONS',
      headers: { origin: WEB_ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    expect(ok.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    const bad = await app.request('/auth/telegram', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('login do painel por QR: POST /auth/qr e GET /auth/qr/:id', () => {
  const ID = '3f1c1b8e-6a63-4b0a-9a35-0d3b3f6a4a11';
  const created = {
    id: ID,
    pollSecret: 'p'.repeat(43),
    deepLink: 'https://t.me/meu_bot?start=login_abc',
    expiresAt: '2026-11-04T12:03:00.000Z',
  };

  it('cria o pedido sem Bearer, sem cache, com IP e navegador de quem chamou', async () => {
    const create = vi.fn(async () => created);
    const { app } = buildApp({ qrLogin: { create, status: vi.fn() } });
    const res = await app.request('/auth/qr', {
      method: 'POST',
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/126', 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual(created);
    expect(create).toHaveBeenCalledWith({ ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (Macintosh) Chrome/126' });
  });

  it('a consulta leva o segredo do cabeçalho X-Poll-Secret e nunca o aceita na URL', async () => {
    const status = vi.fn(async () => ({ status: 'aguardando' as const, expiresAt: created.expiresAt }));
    const { app } = buildApp({ qrLogin: { create: vi.fn(), status } });
    const res = await app.request(`/auth/qr/${ID}`, { headers: { 'x-poll-secret': 'segredo' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(status).toHaveBeenCalledWith({ id: ID, pollSecret: 'segredo' });
    await app.request(`/auth/qr/${ID}?pollSecret=oculto`);
    expect(status).toHaveBeenLastCalledWith({ id: ID, pollSecret: undefined });
  });

  it('desligado: 503 login_desabilitado nas duas rotas', async () => {
    const { app } = buildApp();
    const a = await app.request('/auth/qr', { method: 'POST' });
    const b = await app.request(`/auth/qr/${ID}`);
    expect([a.status, b.status]).toEqual([503, 503]);
    expect(await a.json()).toEqual({ error: 'login_desabilitado' });
  });

  it('muitas tentativas: 429 com Retry-After; reuso: 401', async () => {
    const { app } = buildApp({
      qrLogin: {
        create: async () => {
          throw new TelegramAuthError('muitas_tentativas', 30);
        },
        status: async () => {
          throw new TelegramAuthError('ja_utilizado');
        },
      },
    });
    const a = await app.request('/auth/qr', { method: 'POST' });
    expect(a.status).toBe(429);
    expect(a.headers.get('retry-after')).toBe('30');
    const b = await app.request(`/auth/qr/${ID}`);
    expect(b.status).toBe(401);
    expect(await b.json()).toEqual({ error: 'ja_utilizado' });
  });

  it('o preflight do navegador libera o cabeçalho do segredo só para a origem do painel', async () => {
    const { app } = buildApp();
    const ok = await app.request(`/auth/qr/${ID}`, {
      method: 'OPTIONS',
      headers: { Origin: WEB_ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-poll-secret' },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('x-poll-secret');
    expect(ok.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    const other = await app.request(`/auth/qr/${ID}`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://outro.example', 'Access-Control-Request-Method': 'GET' },
    });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
});
