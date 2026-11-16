import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TelegramAuthError } from '../errors.js';
import type { Clock } from '../ports.js';
import { makeTelegramLogin, type TelegramLoginDeps } from './login.js';
import { makeRateLimiter } from './rate-limit.js';

const TOKEN = '123456:TEST-token-not-real';
const NOW = new Date('2026-11-04T15:00:00Z');
const SECONDS = Math.floor(NOW.getTime() / 1000);

function sign(userId: number, authDate = SECONDS - 10): string {
  const fields: Record<string, string> = {
    auth_date: String(authDate),
    query_id: 'AAH',
    user: JSON.stringify({ id: userId, first_name: 'Ana' }),
  };
  const check = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

function setup(over: Partial<TelegramLoginDeps> = {}, linked: Record<number, string> = { 4242: 'user-1' }) {
  const clock: Clock = { now: () => NOW };
  const used = new Set<string>();
  const issued: string[] = [];
  const deps: TelegramLoginDeps = {
    botToken: TOKEN,
    maxAgeSeconds: 3600,
    replays: {
      async claim(hash) {
        if (used.has(hash)) return false;
        used.add(hash);
        return true;
      },
      async purgeExpired() {
        return 0;
      },
    },
    links: { userForChat: async (chatId) => linked[chatId] ?? null },
    sessions: {
      async issue(userId) {
        issued.push(userId);
        return { tokenHash: `hash-de-${userId}` };
      },
    },
    ipLimiter: makeRateLimiter({ max: 100, windowMs: 60_000, clock }),
    userLimiter: makeRateLimiter({ max: 100, windowMs: 60_000, clock }),
    clock,
    ...over,
  };
  return { login: makeTelegramLogin(deps), used, issued };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof TelegramAuthError ? e.code : `erro:${String(e)}`;
  }
};

describe('makeTelegramLogin', () => {
  it('emite a sessão da conta vinculada àquele Telegram', async () => {
    const { login, issued } = setup();
    expect(await login({ initData: sign(4242), ip: '1.1.1.1' })).toEqual({ tokenHash: 'hash-de-user-1' });
    expect(issued).toEqual(['user-1']);
  });

  it('desligado sem token do bot', async () => {
    const { login } = setup({ botToken: undefined });
    expect(await code(login({ initData: sign(4242), ip: 'x' }))).toBe('login_desabilitado');
  });

  it('assinatura inválida e initData expirado têm códigos próprios', async () => {
    const { login } = setup();
    expect(await code(login({ initData: sign(4242).replace(/hash=./, 'hash=0'), ip: 'x' }))).toBe('assinatura_invalida');
    expect(await code(login({ initData: sign(4242, SECONDS - 7200), ip: 'x' }))).toBe('sessao_expirada');
  });

  it('Telegram sem conta vinculada: recusa e NÃO consome o initData', async () => {
    const { login, used } = setup();
    expect(await code(login({ initData: sign(777), ip: 'x' }))).toBe('telegram_nao_vinculado');
    expect(used.size).toBe(0);
  });

  it('o mesmo initData só abre uma sessão (anti-reuso)', async () => {
    const { login } = setup();
    const data = sign(4242);
    expect(await code(login({ initData: data, ip: 'x' }))).toBe('ok');
    expect(await code(login({ initData: data, ip: 'x' }))).toBe('ja_utilizado');
  });

  it('dois pedidos simultâneos com o mesmo initData: um só vence', async () => {
    const { login, issued } = setup();
    const data = sign(4242);
    const results = await Promise.all([login({ initData: data, ip: 'x' }), login({ initData: data, ip: 'x' })].map(code));
    expect(results.sort()).toEqual(['ja_utilizado', 'ok']);
    expect(issued).toHaveLength(1);
  });

  it('conta que não pode receber sessão é tratada como não vinculada', async () => {
    const { login } = setup({ sessions: { issue: async () => null } });
    expect(await code(login({ initData: sign(4242), ip: 'x' }))).toBe('telegram_nao_vinculado');
  });

  it('o usuário da sessão vem do vínculo, não de um id no corpo', async () => {
    const { login, issued } = setup({}, { 4242: 'user-1', 9: 'user-9' });
    await login({ initData: sign(4242), ip: 'x' });
    expect(issued).toEqual(['user-1']);
  });

  it('limita por IP, com Retry-After, antes de olhar a assinatura', async () => {
    const clock: Clock = { now: () => NOW };
    const { login } = setup({ ipLimiter: makeRateLimiter({ max: 2, windowMs: 60_000, clock }) });
    for (let i = 0; i < 2; i += 1) await login({ initData: 'lixo', ip: '9.9.9.9' }).catch(() => undefined);
    const err = await login({ initData: 'lixo', ip: '9.9.9.9' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TelegramAuthError);
    expect(err).toMatchObject({ code: 'muitas_tentativas', retryAfterSeconds: 60 });
    // Outro IP não é afetado.
    expect(await code(login({ initData: sign(4242), ip: '8.8.8.8' }))).toBe('ok');
  });

  it('limita por usuário do Telegram só com assinatura válida', async () => {
    const clock: Clock = { now: () => NOW };
    const { login } = setup({ userLimiter: makeRateLimiter({ max: 1, windowMs: 60_000, clock }) });
    expect(await code(login({ initData: sign(4242, SECONDS - 1), ip: 'a' }))).toBe('ok');
    expect(await code(login({ initData: sign(4242, SECONDS - 2), ip: 'b' }))).toBe('muitas_tentativas');
    // Assinatura inválida não gasta a cota de ninguém.
    await login({ initData: 'lixo', ip: 'c' }).catch(() => undefined);
    expect(await code(login({ initData: sign(5555), ip: 'd' }))).toBe('telegram_nao_vinculado');
  });
});

describe('makeRateLimiter', () => {
  it('libera de novo quando a janela passa', () => {
    let t = 0;
    const limiter = makeRateLimiter({ max: 1, windowMs: 1000, clock: { now: () => new Date(t) } });
    expect(limiter.hit('k')).toBeNull();
    expect(limiter.hit('k')).toBe(1);
    t = 1001;
    expect(limiter.hit('k')).toBeNull();
  });
});
