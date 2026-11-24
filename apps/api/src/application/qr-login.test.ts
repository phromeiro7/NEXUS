import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFakes } from '../../test/fakes.js';
import { QR_LOGIN_TTL_MS, makeQrLogin } from './qr-login.js';
import { NotFoundError, TelegramAuthError } from './errors.js';
import { makeRateLimiter } from './telegram/rate-limit.js';

const NOW = new Date('2026-11-04T15:00:00.000Z');
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function setup(opts: { botUsername?: string | undefined; sessionFor?: (id: string) => { tokenHash: string } | null; ipMax?: number } = {}) {
  const fakes = createFakes({ now: NOW });
  fakes.links.setChat('user-1', 4242);
  const issued: string[] = [];
  let failIssue = false;
  const qr = makeQrLogin({
    requests: fakes.qrLogins,
    sessions: {
      async issue(userId) {
        if (failIssue) throw new Error('supabase fora do ar');
        issued.push(userId);
        return opts.sessionFor ? opts.sessionFor(userId) : { tokenHash: `token-de-${userId}` };
      },
    },
    botUsername: 'botUsername' in opts ? opts.botUsername : 'nexus_bot',
    profiles: fakes.profiles,
    ipLimiter: makeRateLimiter({ max: opts.ipMax ?? 100, windowMs: 60_000, clock: fakes.clock }),
    pollLimiter: makeRateLimiter({ max: 100, windowMs: 60_000, clock: fakes.clock }),
    clock: fakes.clock,
  });
  const nonceOf = (deepLink: string) => deepLink.split('start=login_')[1]!;
  return { fakes, qr, issued, nonceOf, failIssue: (v: boolean) => (failIssue = v) };
}

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  return undefined;
};

describe('qr login: criar o pedido', () => {
  it('devolve id, segredo de consulta, link do bot e validade de poucos minutos', async () => {
    const { qr, nonceOf } = setup();
    const created = await qr.create({ ip: '1.1.1.1', userAgent: CHROME_MAC });
    expect(created.deepLink).toMatch(/^https:\/\/t\.me\/nexus_bot\?start=login_[A-Za-z0-9_-]{27}$/);
    expect(nonceOf(created.deepLink).length).toBe(27);
    expect(created.pollSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(created.expiresAt) - NOW.getTime()).toBe(QR_LOGIN_TTL_MS);
  });

  it('guarda só hashes: nem o nonce nem o segredo aparecem no que foi gravado', async () => {
    const { qr, fakes, nonceOf } = setup();
    const created = await qr.create({ ip: '1.1.1.1', userAgent: CHROME_MAC });
    const row = fakes.qrLogins.rows()[0]!;
    expect(row.nonceHash).toBe(createHash('sha256').update(nonceOf(created.deepLink)).digest('hex'));
    expect(row.pollSecretHash).toBe(createHash('sha256').update(created.pollSecret).digest('hex'));
    const dump = JSON.stringify(row);
    expect(dump).not.toContain(nonceOf(created.deepLink));
    expect(dump).not.toContain(created.pollSecret);
    expect(row.clientLabel).toBe('Chrome em macOS');
  });

  it('cada pedido tem segredos diferentes', async () => {
    const { qr, nonceOf } = setup();
    const a = await qr.create({ ip: '1.1.1.1', userAgent: undefined });
    const b = await qr.create({ ip: '1.1.1.1', userAgent: undefined });
    expect(a.id).not.toBe(b.id);
    expect(nonceOf(a.deepLink)).not.toBe(nonceOf(b.deepLink));
    expect(a.pollSecret).not.toBe(b.pollSecret);
  });

  it('sem nome do bot o login por QR fica desligado', async () => {
    const { qr } = setup({ botUsername: undefined });
    const error = await errorOf(qr.create({ ip: '1.1.1.1', userAgent: undefined }));
    expect(error).toMatchObject({ name: 'TelegramAuthError', code: 'login_desabilitado' });
  });

  it('limita a criação por IP', async () => {
    const { qr } = setup({ ipMax: 2 });
    await qr.create({ ip: '9.9.9.9', userAgent: undefined });
    await qr.create({ ip: '9.9.9.9', userAgent: undefined });
    const error = await errorOf(qr.create({ ip: '9.9.9.9', userAgent: undefined }));
    expect(error).toMatchObject({ code: 'muitas_tentativas' });
    // outro IP não é afetado
    await expect(qr.create({ ip: '8.8.8.8', userAgent: undefined })).resolves.toBeDefined();
  });
});

describe('qr login: o caminho feliz', () => {
  it('criar, abrir no bot, confirmar e recolher a sessão uma única vez', async () => {
    const { qr, nonceOf, issued } = setup();
    const created = await qr.create({ ip: '1.1.1.1', userAgent: CHROME_MAC });
    await expect(qr.status({ id: created.id, pollSecret: created.pollSecret })).resolves.toMatchObject({ status: 'aguardando' });

    const started = await qr.start({ nonce: nonceOf(created.deepLink), chatId: 4242, userId: 'user-1' });
    expect(started).toMatchObject({ kind: 'perguntar', label: 'Chrome em macOS' });
    if (started.kind !== 'perguntar') throw new Error('esperava a pergunta');
    expect(started.requestId).toBe(created.id);
    await expect(qr.status({ id: created.id, pollSecret: created.pollSecret })).resolves.toMatchObject({ status: 'confirmar' });

    await expect(qr.decide({ requestId: created.id, chatId: 4242, userId: 'user-1', approve: true })).resolves.toBe('aprovado');
    const done = await qr.status({ id: created.id, pollSecret: created.pollSecret });
    expect(done).toMatchObject({ status: 'aprovado', tokenHash: 'token-de-user-1' });
    expect(issued).toEqual(['user-1']);

    // segundo recolhimento: o token não sai de novo
    expect(await errorOf(qr.status({ id: created.id, pollSecret: created.pollSecret }))).toMatchObject({ code: 'ja_utilizado' });
    expect(issued).toEqual(['user-1']);
  });

  it('a hora da pergunta usa o fuso da conta', async () => {
    const { qr, nonceOf, fakes } = setup();
    fakes.setProfile('user-1', { timezone: 'America/Sao_Paulo' });
    const created = await qr.create({ ip: '1.1.1.1', userAgent: undefined });
    const started = await qr.start({ nonce: nonceOf(created.deepLink), chatId: 4242, userId: 'user-1' });
    expect(started).toMatchObject({ kind: 'perguntar', time: '12:00' }); // 15:00Z = 12:00 em São Paulo
  });
});

describe('qr login: quem pode o quê', () => {
  it('"Não fui eu" nega o pedido e nenhuma sessão é emitida', async () => {
    const { qr, nonceOf, issued } = setup();
    const created = await qr.create({ ip: '1.1.1.1', userAgent: undefined });
    await qr.start({ nonce: nonceOf(created.deepLink), chatId: 4242, userId: 'user-1' });
    await expect(qr.decide({ requestId: created.id, chatId: 4242, userId: 'user-1', approve: false })).resolves.toBe('negado');
    await expect(qr.status({ id: created.id, pollSecret: created.pollSecret })).resolves.toMatchObject({ status: 'negado' });
    expect(issued).toEqual([]);
  });

  it('Telegram sem conta é recusado e nunca recebe pergunta', async () => {
    const { qr, nonceOf, issued } = setup();
    const created = await qr.create({ ip: '1.1.1.1', userAgent: undefined });
    await expect(qr.start({ nonce: nonceOf(created.deepLink), chatId: 999, userId: null })).resolves.toEqual({ kind: 'recusado' });
    await expect(qr.status({ id: created.id, pollSecret: created.pollSecret })).resolves.toMatchObject({ status: 'recusado' });
    expect(issued).toEqual([]);
  });

  it('só o chat que abriu o pedido, para a conta perguntada, pode decidir', async () => {
    const { qr, nonceOf } = setup();
    const created = await qr.create({ ip: '1.1.1.1', userAgent: undefined });
    await qr.start({ nonce: nonceOf(created.deepLink), chatId: 4242, userId: 'user-1' });
    await expect(qr.decide({ requestId: created.id, chatId: 5555, userId: 'user-1', approve: true })).resolves.toBe('expirado');
    await expect(qr.decide({ requestId: created.id, chatId: 4242, userId: 'outra-conta', approve: true })).resolves.toBe('expirado');
    await expect(qr.status({ id: created.id, pollSecret: created.pollSecret })).resolves.toMatchObject({ status: 'confirmar' });
  });

  it('decidir duas vezes não muda o resultado (idempotente)', async () => {
    const { qr, nonceOf } = setup();
    const created = await qr.create({ ip: '1.1.1.1', userAgent: undefined });
    await qr.start({ nonce: nonceOf(created.deepLink), chatId: 4242, userId: 'user-1' });
    await expect(qr.decide({ requestId: created.id, chatId: 4242, userId: 'user-1', approve: true })).resolves.toBe('aprovado');
    await expect(qr.decide({ requestId: created.id, chatId: 4242, userId: 'user-1', approve: false })).resolves.toBe('expirado');
    const done = await qr.status({ id: created.id, pollSecret: created.pollSecret });
    expect(done.status).toBe('aprovado');
  });

  it('abrir o mesmo QR duas vezes (outro Telegram) não rouba o pedido', async () => {
    const { qr, nonceOf } = setup();
    const created = await qr.create({ ip: '1.1.1.1', userAgent: undefined });
    await qr.start({ nonce: nonceOf(created.deepLink), chatId: 4242, userId: 'user-1' });
    await expect(qr.start({ nonce: nonceOf(created.deepLink), chatId: 7777, userId: 'user-2' })).resolves.toEqual({ kind: 'invalido' });
  });

  it('nonce desconhecido ou com formato errado é inválido, sem dizer por quê', async () => {
    const { qr } = setup();
    await expect(qr.start({ nonce: 'a'.repeat(27), chatId: 1, userId: 'user-1' })).resolves.toEqual({ kind: 'invalido' });
    await expect(qr.start({ nonce: 'curto', chatId: 1, userId: 'user-1' })).resolves.toEqual({ kind: 'invalido' });
    await expect(qr.start({ nonce: '../../etc', chatId: 1, userId: 'user-1' })).resolves.toEqual({ kind: 'invalido' });
  });
});

describe('qr login: o navegador que consulta', () => {
  it('segredo errado, ausente ou id desconhecido: 404 igual, sem dizer qual', async () => {
    const { qr, nonceOf } = setup();
    const created = await qr.create({ ip: '1.1.1.1', userAgent: undefined });
    await qr.start({ nonce: nonceOf(created.deepLink), chatId: 4242, userId: 'user-1' });
    await qr.decide({ requestId: created.id, chatId: 4242, userId: 'user-1', approve: true });

    for (const input of [
      { id: created.id, pollSecret: 'x'.repeat(43) },
      { id: created.id, pollSecret: undefined },
      { id: '3f1c1b8e-6a63-4b0a-9a35-0d3b3f6a4a11', pollSecret: created.pollSecret },
      { id: 'nao-e-uuid', pollSecret: created.pollSecret },
    ]) {
      expect(await errorOf(qr.status(input))).toBeInstanceOf(NotFoundError);
    }
    // quem não tem o segredo nunca recebe o token, e o pedido segue disponível para o dono
    await expect(qr.status({ id: created.id, pollSecret: created.pollSecret })).resolves.toMatchObject({ status: 'aprovado' });
  });

  it('depois de vencer o pedido aparece como expirado, mesmo que já aprovado', async () => {
    const { qr, nonceOf, fakes, issued } = setup();
    const created = await qr.create({ ip: '1.1.1.1', userAgent: undefined });
    await qr.start({ nonce: nonceOf(created.deepLink), chatId: 4242, userId: 'user-1' });
    await qr.decide({ requestId: created.id, chatId: 4242, userId: 'user-1', approve: true });
    fakes.setNow(new Date(NOW.getTime() + QR_LOGIN_TTL_MS + 1000));
    await expect(qr.status({ id: created.id, pollSecret: created.pollSecret })).resolves.toMatchObject({ status: 'expirado' });
    expect(issued).toEqual([]);
  });

  it('um pedido vencido não pode mais ser aberto nem decidido', async () => {
    const { qr, nonceOf, fakes } = setup();
    const created = await qr.create({ ip: '1.1.1.1', userAgent: undefined });
    await qr.start({ nonce: nonceOf(created.deepLink), chatId: 4242, userId: 'user-1' });
    fakes.setNow(new Date(NOW.getTime() + QR_LOGIN_TTL_MS + 1000));
    await expect(qr.decide({ requestId: created.id, chatId: 4242, userId: 'user-1', approve: true })).resolves.toBe('expirado');
    const old = await qr.create({ ip: '1.1.1.1', userAgent: undefined });
    fakes.setNow(new Date(NOW.getTime() + 2 * QR_LOGIN_TTL_MS + 5000));
    await expect(qr.start({ nonce: nonceOf(old.deepLink), chatId: 4242, userId: 'user-1' })).resolves.toEqual({ kind: 'invalido' });
  });

  it('dois navegadores recolhendo ao mesmo tempo: só um recebe o token', async () => {
    const { qr, nonceOf, issued } = setup();
    const created = await qr.create({ ip: '1.1.1.1', userAgent: undefined });
    await qr.start({ nonce: nonceOf(created.deepLink), chatId: 4242, userId: 'user-1' });
    await qr.decide({ requestId: created.id, chatId: 4242, userId: 'user-1', approve: true });
    const results = await Promise.allSettled([
      qr.status({ id: created.id, pollSecret: created.pollSecret }),
      qr.status({ id: created.id, pollSecret: created.pollSecret }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(issued).toEqual(['user-1']);
  });

  it('se emitir a sessão falhar, o pedido volta a poder ser recolhido', async () => {
    const { qr, nonceOf, failIssue, issued } = setup();
    const created = await qr.create({ ip: '1.1.1.1', userAgent: undefined });
    await qr.start({ nonce: nonceOf(created.deepLink), chatId: 4242, userId: 'user-1' });
    await qr.decide({ requestId: created.id, chatId: 4242, userId: 'user-1', approve: true });
    failIssue(true);
    await expect(qr.status({ id: created.id, pollSecret: created.pollSecret })).rejects.toThrow();
    failIssue(false);
    await expect(qr.status({ id: created.id, pollSecret: created.pollSecret })).resolves.toMatchObject({ status: 'aprovado', tokenHash: 'token-de-user-1' });
    expect(issued).toEqual(['user-1']);
  });

  it('conta sem como receber sessão: recusado, e o pedido é devolvido', async () => {
    const { qr, nonceOf, fakes } = setup({ sessionFor: () => null });
    const created = await qr.create({ ip: '1.1.1.1', userAgent: undefined });
    await qr.start({ nonce: nonceOf(created.deepLink), chatId: 4242, userId: 'user-1' });
    await qr.decide({ requestId: created.id, chatId: 4242, userId: 'user-1', approve: true });
    await expect(qr.status({ id: created.id, pollSecret: created.pollSecret })).resolves.toMatchObject({ status: 'recusado' });
    expect(fakes.qrLogins.rows()[0]!.status).toBe('aprovado');
  });

  it('limita as consultas por pedido', async () => {
    const fakes = createFakes({ now: NOW });
    const qr = makeQrLogin({
      requests: fakes.qrLogins,
      sessions: { issue: async () => null },
      botUsername: 'nexus_bot',
      profiles: fakes.profiles,
      ipLimiter: makeRateLimiter({ max: 100, windowMs: 60_000, clock: fakes.clock }),
      pollLimiter: makeRateLimiter({ max: 3, windowMs: 60_000, clock: fakes.clock }),
      clock: fakes.clock,
    });
    const created = await qr.create({ ip: '1.1.1.1', userAgent: undefined });
    for (let i = 0; i < 3; i++) await qr.status({ id: created.id, pollSecret: created.pollSecret });
    expect(await errorOf(qr.status({ id: created.id, pollSecret: created.pollSecret }))).toBeInstanceOf(TelegramAuthError);
  });

  it('a limpeza remove só os pedidos vencidos há mais de dez minutos', async () => {
    const { qr, fakes } = setup();
    await qr.create({ ip: '1.1.1.1', userAgent: undefined });
    fakes.setNow(new Date(NOW.getTime() + QR_LOGIN_TTL_MS + 5 * 60_000));
    expect(await qr.purgeExpired(fakes.clock.now())).toBe(0);
    fakes.setNow(new Date(NOW.getTime() + QR_LOGIN_TTL_MS + 11 * 60_000));
    expect(await qr.purgeExpired(fakes.clock.now())).toBe(1);
  });
});
