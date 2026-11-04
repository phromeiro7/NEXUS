import { describe, expect, it } from 'vitest';
import { createFakes } from '../../../test/fakes.js';
import { makeQrLogin, QR_LOGIN_TTL_MS } from '../qr-login.js';
import { createFailedStartLimiter } from './failed-start-limiter.js';
import { makeRateLimiter } from './rate-limit.js';
import { makeHandleTelegramUpdate } from './webhook.js';

const NOW = new Date('2026-11-04T15:00:00.000Z');
const OWNER = 'user-1';
const OWNER_CHAT = 4242;
const STRANGER_CHAT = 9001;
const OTHER = 'user-2';
const OTHER_CHAT = 4343;

function setup(opts: { withQr?: boolean } = {}) {
  const fakes = createFakes({ now: NOW });
  fakes.links.setChat(OWNER, OWNER_CHAT);
  fakes.links.setChat(OTHER, OTHER_CHAT);
  const sessions: string[] = [];
  const qr = makeQrLogin({
    requests: fakes.qrLogins,
    sessions: {
      async issue(userId) {
        sessions.push(userId);
        return { tokenHash: `token-${userId}` };
      },
    },
    botUsername: 'nexus_bot',
    profiles: fakes.profiles,
    ipLimiter: makeRateLimiter({ max: 100, windowMs: 60_000, clock: fakes.clock }),
    pollLimiter: makeRateLimiter({ max: 100, windowMs: 60_000, clock: fakes.clock }),
    clock: fakes.clock,
  });
  const logs: string[] = [];
  const handle = makeHandleTelegramUpdate({
    links: fakes.links,
    events: fakes.inboundEvents,
    confirmations: fakes.confirmations,
    processMessage: async () => {
      throw new Error('o assistente não deveria ser chamado');
    },
    telegram: fakes.telegram,
    clock: fakes.clock,
    logger: { info: () => undefined, error: (event) => void logs.push(event) },
    botUsername: 'nexus_bot',
    failedStartLimiter: createFailedStartLimiter({ max: 5, windowMs: 10 * 60_000 }),
    ...(opts.withQr === false ? {} : { qrLogin: qr }),
  });
  let updateId = 1;
  const start = (chatId: number, param: string) =>
    handle({
      update_id: updateId++,
      message: { message_id: 10 + updateId, chat: { id: chatId, type: 'private' }, text: `/start ${param}` },
    });
  const tap = (chatId: number, data: string, messageId = 77, id = updateId) =>
    handle({
      update_id: id === updateId ? updateId++ : id,
      callback_query: { id: `cb${id}`, data, message: { message_id: messageId, chat: { id: chatId, type: 'private' } } },
    });
  const sentTo = (chatId: number) => fakes.telegram.sent.filter((m) => m.chatId === chatId);
  const newRequest = async () => {
    const created = await qr.create({ ip: '1.1.1.1', userAgent: 'Mozilla/5.0 (Macintosh) Chrome/126.0 Safari/537.36' });
    return { created, nonce: created.deepLink.split('start=')[1]! };
  };
  return { fakes, handle, start, tap, sentTo, logs, qr, sessions, newRequest };
}

const buttons = (s: ReturnType<typeof setup>, chat: number) => s.sentTo(chat).at(-1)!.keyboard![0]!;

describe('/start login_<nonce> (login do painel)', () => {
  it('conta vinculada: o bot pergunta com navegador, hora e os botões Confirmar / Não fui eu', async () => {
    const s = setup();
    const { nonce } = await s.newRequest();
    await s.start(OWNER_CHAT, nonce);
    const [ask] = s.sentTo(OWNER_CHAT);
    expect(ask!.text).toContain('Entrar no painel do Nexus pelo navegador?');
    expect(ask!.text).toContain('Chrome em macOS · 12:00');
    expect(ask!.text).toMatch(/Confirme só se foi você quem acabou de abrir o painel/);
    expect(buttons(s, OWNER_CHAT).map((b) => b.text)).toEqual(['Confirmar', 'Não fui eu']);
    expect(s.fakes.qrLogins.rows()[0]!.status).toBe('confirmar');
  });

  it('Telegram sem conta: recusa com a mensagem do convite e marca o pedido como recusado', async () => {
    const s = setup();
    const { nonce, created } = await s.newRequest();
    await s.start(STRANGER_CHAT, nonce);
    expect(s.sentTo(STRANGER_CHAT).map((m) => m.text)).toEqual(['Este Telegram ainda não tem acesso ao Nexus. Peça um convite.']);
    expect(s.fakes.qrLogins.rows().find((r) => r.id === created.id)!.status).toBe('recusado');
    expect(s.sessions).toEqual([]);
  });

  it('código desconhecido, já usado ou vencido: mensagem única, sem dizer o motivo', async () => {
    const s = setup();
    const { nonce } = await s.newRequest();
    await s.start(OWNER_CHAT, nonce);
    s.fakes.telegram.sent.length = 0;
    await s.start(OTHER_CHAT, nonce); // já aberto por outro
    await s.start(OWNER_CHAT, 'login_' + 'z'.repeat(27)); // nunca existiu
    s.fakes.setNow(new Date(NOW.getTime() + QR_LOGIN_TTL_MS + 5000));
    const old = await s.newRequest();
    s.fakes.setNow(new Date(NOW.getTime() + 2 * QR_LOGIN_TTL_MS + 20_000));
    await s.start(OWNER_CHAT, old.nonce); // venceu
    const texts = [...s.sentTo(OTHER_CHAT), ...s.sentTo(OWNER_CHAT)].map((m) => m.text);
    expect(new Set(texts)).toEqual(new Set(['Este código de login já foi usado ou expirou. Gere um novo no computador.']));
    expect(texts).toHaveLength(3);
  });

  it('tentativas inválidas repetidas do mesmo chat são limitadas', async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) await s.start(OWNER_CHAT, 'login_' + 'a'.repeat(20 + i));
    s.fakes.telegram.sent.length = 0;
    const { nonce } = await s.newRequest();
    await s.start(OWNER_CHAT, nonce); // o limite já estourou
    expect(s.sentTo(OWNER_CHAT)[0]!.text).toMatch(/Muitas tentativas/);
    expect(s.fakes.qrLogins.rows().at(-1)!.status).toBe('aguardando');
  });

  it('reenviar o mesmo /start (mesma update) não pergunta duas vezes', async () => {
    const s = setup();
    const { nonce } = await s.newRequest();
    const update = {
      update_id: 5000,
      message: { message_id: 1, chat: { id: OWNER_CHAT, type: 'private' }, text: `/start ${nonce}` },
    };
    await s.handle(update);
    await s.handle(update);
    expect(s.sentTo(OWNER_CHAT)).toHaveLength(1);
  });

  it('sem o login por QR ligado, o link cai no caminho de código inválido (nada é aberto)', async () => {
    const s = setup({ withQr: false });
    const { nonce } = await s.newRequest();
    await s.start(OWNER_CHAT, nonce);
    expect(s.sentTo(OWNER_CHAT)[0]!.text).toBe('Código inválido ou vencido. Gere outro no painel.');
    expect(s.fakes.qrLogins.rows()[0]!.status).toBe('aguardando');
  });
});

describe('botões do login do painel', () => {
  const approve = (id: string) => `ql:y:${id}`;
  const deny = (id: string) => `ql:n:${id}`;

  it('Confirmar aprova, tira os botões e o navegador recebe o token uma vez', async () => {
    const s = setup();
    const { nonce, created } = await s.newRequest();
    await s.start(OWNER_CHAT, nonce);
    await s.tap(OWNER_CHAT, approve(created.id), 90);
    expect(s.fakes.qrLogins.rows()[0]!.status).toBe('aprovado');
    expect(s.fakes.telegram.edits.at(-1)).toMatchObject({ chatId: OWNER_CHAT, messageId: 90 });
    expect(s.fakes.telegram.edits.at(-1)!.keyboard).toBeUndefined();
    expect(s.fakes.telegram.edits.at(-1)!.text).toMatch(/o painel foi liberado/);
    const polled = await s.qr.status({ id: created.id, pollSecret: created.pollSecret });
    expect(polled).toMatchObject({ status: 'aprovado', tokenHash: 'token-user-1' });
  });

  it('Não fui eu nega: "o acesso foi bloqueado" e nenhuma sessão sai', async () => {
    const s = setup();
    const { nonce, created } = await s.newRequest();
    await s.start(OWNER_CHAT, nonce);
    await s.tap(OWNER_CHAT, deny(created.id), 90);
    expect(s.fakes.qrLogins.rows()[0]!.status).toBe('negado');
    expect(s.fakes.telegram.edits.at(-1)!.text).toBe('Tudo certo, o acesso foi bloqueado.');
    await expect(s.qr.status({ id: created.id, pollSecret: created.pollSecret })).resolves.toMatchObject({ status: 'negado' });
    expect(s.sessions).toEqual([]);
  });

  it('só o chat que abriu o pedido decide: outro chat vinculado não aprova', async () => {
    const s = setup();
    const { nonce, created } = await s.newRequest();
    await s.start(OWNER_CHAT, nonce);
    await s.tap(OTHER_CHAT, approve(created.id));
    expect(s.fakes.qrLogins.rows()[0]!.status).toBe('confirmar');
    expect(s.fakes.telegram.edits).toHaveLength(0);
  });

  it('chat sem conta não decide nada', async () => {
    const s = setup();
    const { nonce, created } = await s.newRequest();
    await s.start(OWNER_CHAT, nonce);
    await s.tap(STRANGER_CHAT, approve(created.id));
    expect(s.fakes.qrLogins.rows()[0]!.status).toBe('confirmar');
  });

  it('o mesmo toque entregue duas vezes (update repetido) vale uma só vez', async () => {
    const s = setup();
    const { nonce, created } = await s.newRequest();
    await s.start(OWNER_CHAT, nonce);
    const update = {
      update_id: 7000,
      callback_query: { id: 'cb7000', data: approve(created.id), message: { message_id: 90, chat: { id: OWNER_CHAT, type: 'private' } } },
    };
    await s.handle(update);
    await s.handle(update);
    expect(s.fakes.telegram.edits).toHaveLength(1);
  });

  it('depois de decidido, outro toque só avisa e não reescreve a mensagem', async () => {
    const s = setup();
    const { nonce, created } = await s.newRequest();
    await s.start(OWNER_CHAT, nonce);
    await s.tap(OWNER_CHAT, approve(created.id), 90);
    const editsAfterFirst = s.fakes.telegram.edits.length;
    await s.tap(OWNER_CHAT, deny(created.id), 90);
    expect(s.fakes.telegram.edits).toHaveLength(editsAfterFirst);
    expect(s.fakes.qrLogins.rows()[0]!.status).toBe('aprovado');
  });

  it('pedido vencido: o toque não aprova', async () => {
    const s = setup();
    const { nonce, created } = await s.newRequest();
    await s.start(OWNER_CHAT, nonce);
    s.fakes.setNow(new Date(NOW.getTime() + QR_LOGIN_TTL_MS + 1000));
    await s.tap(OWNER_CHAT, approve(created.id));
    expect(s.fakes.qrLogins.rows()[0]!.status).toBe('confirmar');
    await expect(s.qr.status({ id: created.id, pollSecret: created.pollSecret })).resolves.toMatchObject({ status: 'expirado' });
  });

  it('dado de botão malformado é ignorado', async () => {
    const s = setup();
    await s.tap(OWNER_CHAT, 'ql:y:nao-e-uuid');
    await s.tap(OWNER_CHAT, 'ql:x:3f1c1b8e-6a63-4b0a-9a35-0d3b3f6a4a11');
    expect(s.fakes.telegram.edits).toHaveLength(0);
  });

  it('nunca registra nonce, segredo nem token nos logs', async () => {
    const s = setup();
    const { nonce, created } = await s.newRequest();
    await s.start(OWNER_CHAT, nonce);
    await s.tap(OWNER_CHAT, approve(created.id));
    const dump = JSON.stringify(s.logs);
    expect(dump).not.toContain(nonce);
    expect(dump).not.toContain(created.pollSecret);
  });
});
