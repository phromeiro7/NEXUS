import { afterEach, describe, expect, it, vi } from 'vitest';
import { anon, buildApp, req } from '../../test/harness.js';
import { secretsMatch } from './secret.js';

const SECRET = 'TEST_WEBHOOK_SECRET';
const UNAUTH = { error: 'nao_autenticado' };

afterEach(() => vi.restoreAllMocks());

function setup(opts: { secret?: string | undefined; handler?: (u: unknown) => Promise<void> } = {}) {
  const updates: unknown[] = [];
  const handler = opts.handler ?? (async (u: unknown) => void updates.push(u));
  const secret = 'secret' in opts ? opts.secret : SECRET;
  const { app, fakes } = buildApp({
    handleTelegramUpdate: handler,
    ...(secret !== undefined ? { telegramWebhookSecret: secret } : {}),
  });
  return { app, fakes, updates };
}

const hook = (app: ReturnType<typeof setup>['app'], headers: Record<string, string>, body: string = '{"update_id":1}') =>
  app.request('/telegram/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

describe('POST /telegram/link-codes', () => {
  it('requires auth', async () => {
    const { app } = setup();
    expect((await anon(app, 'POST', '/telegram/link-codes')).status).toBe(401);
  });

  it('returns the DTO with the right format and a deepLink', async () => {
    const { app } = setup();
    const res = await req(app, 'POST', '/telegram/link-codes');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; deepLink: string; expiresAt: string };
    expect(body.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(body.deepLink).toBe(`https://t.me/meu_bot?start=${body.code}`);
    expect(body.expiresAt).toBe('2026-10-26T12:10:00.000Z');
  });

  it('a new code invalidates the previous one', async () => {
    const { app, fakes } = setup();
    const a = (await (await req(app, 'POST', '/telegram/link-codes')).json()) as { code: string };
    const b = (await (await req(app, 'POST', '/telegram/link-codes')).json()) as { code: string };
    expect(fakes.links.codesOf('u1')).toEqual([b.code]);
    expect(b.code).not.toBe(a.code);
  });

  it('503 telegram_nao_configurado without a bot username', async () => {
    const { app } = buildApp({ botUsername: null });
    const res = await req(app, 'POST', '/telegram/link-codes');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'telegram_nao_configurado' });
  });
});

describe('DELETE /telegram/link', () => {
  it('requires auth', async () => {
    const { app } = setup();
    expect((await anon(app, 'DELETE', '/telegram/link')).status).toBe(401);
  });

  it('204 and only the caller is unlinked', async () => {
    const { app, fakes } = setup();
    fakes.links.setChat('u1', 111);
    fakes.links.setChat('u2', 222);
    const res = await req(app, 'DELETE', '/telegram/link');
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(fakes.links.chatFor('u1')).toBeNull();
    expect(fakes.links.chatFor('u2')).toBe(222);
  });
});

describe('POST /telegram/webhook', () => {
  it('200 and the handler gets the parsed update when the secret matches', async () => {
    const { app, updates } = setup();
    const res = await hook(app, { 'X-Telegram-Bot-Api-Secret-Token': SECRET }, '{"update_id":7,"x":[1]}');
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ update_id: 7, x: [1] }]);
  });

  it('needs no user token', async () => {
    const { app } = setup();
    expect((await hook(app, { 'X-Telegram-Bot-Api-Secret-Token': SECRET })).status).toBe(200);
  });

  const bad: Array<[string, Record<string, string>]> = [
    ['no header', {}],
    ['a wrong secret of the same length', { 'X-Telegram-Bot-Api-Secret-Token': 'TEST_WEBHOOK_SECRES' }],
    ['a shorter secret', { 'X-Telegram-Bot-Api-Secret-Token': 'x' }],
    ['a longer secret', { 'X-Telegram-Bot-Api-Secret-Token': `${SECRET}${SECRET}` }],
    ['a prefix of the secret', { 'X-Telegram-Bot-Api-Secret-Token': SECRET.slice(0, -1) }],
    ['an empty header', { 'X-Telegram-Bot-Api-Secret-Token': '' }],
    ['the internal secret header instead', { 'X-Internal-Secret': SECRET }],
    ['a bearer token', { Authorization: `Bearer ${SECRET}` }],
  ];
  it.each(bad)('401 with an identical non-informative body for %s; the handler does not run', async (_n, headers) => {
    const { app, updates } = setup();
    const res = await hook(app, headers);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(JSON.stringify(UNAUTH));
    expect(updates).toEqual([]);
  });

  it('503 webhook_desabilitado BEFORE reading the header when no secret is configured', async () => {
    const variants: Array<Record<string, string>> = [
      {},
      { 'X-Telegram-Bot-Api-Secret-Token': SECRET },
      { 'X-Telegram-Bot-Api-Secret-Token': '' },
    ];
    for (const headers of variants) {
      const { app, updates } = setup({ secret: undefined });
      const res = await hook(app, headers);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'webhook_desabilitado' });
      expect(updates).toEqual([]);
    }
  });

  it('503 webhook_desabilitado when the handler is absent', async () => {
    const { app } = buildApp({ telegramWebhookSecret: SECRET });
    const res = await hook(app, { 'X-Telegram-Bot-Api-Secret-Token': SECRET });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'webhook_desabilitado' });
  });

  it('200 and ignored for garbage JSON, empty bodies and non-object JSON', async () => {
    const { app, updates } = setup();
    const h = { 'X-Telegram-Bot-Api-Secret-Token': SECRET };
    for (const body of ['{nao json', '', 'null', '42', '"x"']) {
      expect((await hook(app, h, body)).status).toBe(200);
    }
    // JSON válido chega ao tratador (que é tolerante); o inválido não.
    expect(updates).toEqual([null, 42, 'x']);
  });

  it('200 even when the handler throws; logs only the error NAME, never the message or the secret', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = setup({
      handler: async () => {
        throw new TypeError(`explodiu com ${SECRET} e texto do usuário`);
      },
    });
    const res = await hook(app, { 'X-Telegram-Bot-Api-Secret-Token': SECRET });
    expect(res.status).toBe(200);
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain('TypeError');
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain('texto do usuário');
  });

  it('never echoes the secret in any response', async () => {
    const { app } = setup();
    const texts: string[] = [];
    const variants: Array<Record<string, string>> = [
      {},
      { 'X-Telegram-Bot-Api-Secret-Token': SECRET },
      { 'X-Telegram-Bot-Api-Secret-Token': 'errado' },
    ];
    for (const headers of variants) {
      const res = await hook(app, headers);
      texts.push(await res.text(), JSON.stringify([...res.headers.entries()]));
    }
    expect(texts.join('\n')).not.toContain(SECRET);
  });

  it('the shared comparison never throws on different lengths and only accepts equal strings', () => {
    expect(secretsMatch(SECRET, SECRET)).toBe(true);
    expect(secretsMatch('', SECRET)).toBe(false);
    expect(secretsMatch(`${SECRET}x`, SECRET)).toBe(false);
    expect(secretsMatch('x', SECRET)).toBe(false);
    expect(secretsMatch('', '')).toBe(true);
  });
});
