import { describe, expect, it } from 'vitest';
import { createFakes } from '../../../test/fakes.js';
import { makeAcceptInvite, makeInviteUseCases } from '../invites.js';
import { createFailedStartLimiter } from './failed-start-limiter.js';
import { makeHandleTelegramUpdate } from './webhook.js';

const NOW = new Date('2026-11-04T12:00:00.000Z');
const ADMIN = 'admin-user';
const ADMIN_CHAT = 111;
const PLAIN = 'plain-user';
const PLAIN_CHAT = 222;
const GUEST_CHAT = 555;
const MINI_APP = 'https://nexus.example.com';

function setup(opts: { withInvites?: boolean; admins?: number[] } = {}) {
  const fakes = createFakes({ now: NOW });
  fakes.links.setChat(ADMIN, ADMIN_CHAT);
  fakes.links.setChat(PLAIN, PLAIN_CHAT);
  const inviteUseCases = makeInviteUseCases({
    invites: fakes.invites,
    accounts: fakes.accounts,
    adminTelegramIds: new Set(opts.admins ?? [ADMIN_CHAT]),
    botUsername: 'nexus_bot',
    clock: fakes.clock,
  });
  const acceptInvite = makeAcceptInvite({
    invites: fakes.invites,
    accounts: fakes.accounts,
    links: fakes.links,
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
    miniAppUrl: MINI_APP,
    ...(opts.withInvites === false ? {} : { invites: inviteUseCases, acceptInvite }),
  });
  let updateId = 1;
  const say = (chatId: number, text: string) =>
    handle({
      update_id: updateId++,
      message: { message_id: 10 + updateId, chat: { id: chatId, type: 'private' }, text },
    });
  const tap = (chatId: number, data: string, messageId = 77) =>
    handle({
      update_id: updateId++,
      callback_query: { id: `cb${updateId}`, data, message: { message_id: messageId, chat: { id: chatId, type: 'private' } } },
    });
  const sentTo = (chatId: number) => fakes.telegram.sent.filter((m) => m.chatId === chatId);
  return { fakes, handle, say, tap, sentTo, logs, inviteUseCases };
}

describe('/meuid', () => {
  it('tells anyone their Telegram id', async () => {
    const s = setup();
    await s.say(GUEST_CHAT, '/meuid');
    expect(s.sentTo(GUEST_CHAT).map((m) => m.text)).toEqual(['Seu id do Telegram é 555.']);
  });

  it('does not exist when invites are off: it is plain text', async () => {
    const s = setup({ withInvites: false });
    await s.say(PLAIN_CHAT, '/meuid');
    expect(s.sentTo(PLAIN_CHAT).some((m) => m.text.includes('Seu id'))).toBe(false);
  });
});

describe('/convite (administrators only)', () => {
  it('an administrator gets a ready-to-forward link, the validity and a share button', async () => {
    const s = setup();
    await s.say(ADMIN_CHAT, '/convite');
    const [reply] = s.sentTo(ADMIN_CHAT);
    expect(reply!.text).toMatch(/^Convite criado\. Vale por 7 dias e abre uma conta só\.\nhttps:\/\/t\.me\/nexus_bot\?start=[A-Z2-9]{12}$/);
    const button = reply!.keyboard![0]![0]!;
    expect(button.text).toBe('Compartilhar');
    expect('url' in button && button.url).toMatch(/^https:\/\/t\.me\/share\/url\?url=https%3A%2F%2Ft\.me%2Fnexus_bot%3Fstart%3D/);
    expect(s.fakes.invites.rows()).toHaveLength(1);
  });

  it('a non-administrator gets no reply that reveals the command exists (plain text path)', async () => {
    const s = setup();
    await s.say(PLAIN_CHAT, '/convite');
    await s.say(PLAIN_CHAT, '/convites');
    expect(s.fakes.invites.rows()).toHaveLength(0);
    expect(s.sentTo(PLAIN_CHAT).some((m) => /convite criado|convite ativo/i.test(m.text))).toBe(false);
  });

  it('an unlinked chat in the admin list is asked to link first', async () => {
    const s = setup({ admins: [GUEST_CHAT] });
    await s.say(GUEST_CHAT, '/convite');
    expect(s.sentTo(GUEST_CHAT)[0]!.text).toMatch(/Vincule sua conta primeiro/);
    expect(s.fakes.invites.rows()).toHaveLength(0);
  });
});

describe('/convites and revoking', () => {
  it('lists only active invites, each with a Revogar button', async () => {
    const s = setup();
    await s.say(ADMIN_CHAT, '/convite');
    s.fakes.invites.seed({ code: 'EEEEEEEEEEEE', usedAt: NOW });
    s.fakes.telegram.sent.length = 0;
    await s.say(ADMIN_CHAT, '/convites');
    const msgs = s.sentTo(ADMIN_CHAT);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toMatch(/^Convite ativo, vale até 11\/11\.\nhttps:\/\/t\.me\/nexus_bot\?start=/);
    const b = msgs[0]!.keyboard![0]![0]!;
    expect('callbackData' in b && b.callbackData).toMatch(/^iv:r:[A-Z2-9]{12}$/);
  });

  it('says so when there is nothing active', async () => {
    const s = setup();
    await s.say(ADMIN_CHAT, '/convites');
    expect(s.sentTo(ADMIN_CHAT)[0]!.text).toBe('Nenhum convite ativo. Envie /convite para criar um.');
  });

  it('Revogar revokes, edits the message and a guest can no longer use the code', async () => {
    const s = setup();
    await s.say(ADMIN_CHAT, '/convite');
    const code = s.fakes.invites.rows()[0]!.code;
    await s.tap(ADMIN_CHAT, `iv:r:${code}`);
    expect(s.fakes.invites.rows()[0]!.revokedAt).not.toBeNull();
    expect(s.fakes.telegram.edits.at(-1)).toMatchObject({ chatId: ADMIN_CHAT, messageId: 77, text: 'Convite revogado.' });
    await s.say(GUEST_CHAT, `/start ${code}`);
    expect(s.sentTo(GUEST_CHAT)[0]!.text).toBe('Convite inválido ou expirado.');
  });

  it('a non-administrator tapping Revogar changes nothing', async () => {
    const s = setup();
    await s.say(ADMIN_CHAT, '/convite');
    const code = s.fakes.invites.rows()[0]!.code;
    await s.tap(PLAIN_CHAT, `iv:r:${code}`);
    expect(s.fakes.invites.rows()[0]!.revokedAt).toBeNull();
    expect(s.fakes.telegram.answers.at(-1)?.text).toBe('Só administradores criam convites.');
  });

  it('tapping the same Revogar update twice revokes once', async () => {
    const s = setup();
    await s.say(ADMIN_CHAT, '/convite');
    const code = s.fakes.invites.rows()[0]!.code;
    const update = {
      update_id: 900,
      callback_query: { id: 'cbx', data: `iv:r:${code}`, message: { message_id: 5, chat: { id: ADMIN_CHAT, type: 'private' } } },
    };
    await s.handle(update);
    await s.handle(update);
    expect(s.fakes.telegram.edits.filter((e) => e.text === 'Convite revogado.')).toHaveLength(1);
  });
});

describe('/start CONVITE', () => {
  async function invite(s: ReturnType<typeof setup>) {
    await s.say(ADMIN_CHAT, '/convite');
    return s.fakes.invites.rows()[0]!.code;
  }

  it('creates the account, links the chat and offers to open the Mini App', async () => {
    const s = setup();
    const code = await invite(s);
    await s.say(GUEST_CHAT, `/start ${code}`);
    const reply = s.sentTo(GUEST_CHAT)[0]!;
    expect(reply.text).toBe('Pronto, sua conta foi criada.');
    expect(reply.keyboard).toEqual([[{ text: 'Abrir o Nexus', webAppUrl: MINI_APP }]]);
    expect(await s.fakes.links.userForChat(GUEST_CHAT)).toBe('invited-1');
    expect(s.fakes.invites.rows()[0]!.usedAt).not.toBeNull();
  });

  it('accepts the code in lower case, as people paste it', async () => {
    const s = setup();
    const code = await invite(s);
    await s.say(GUEST_CHAT, `/start ${code.toLowerCase()}`);
    expect(s.sentTo(GUEST_CHAT)[0]!.text).toBe('Pronto, sua conta foi criada.');
  });

  it('the same invite for a second person is invalid', async () => {
    const s = setup();
    const code = await invite(s);
    await s.say(GUEST_CHAT, `/start ${code}`);
    await s.say(666, `/start ${code}`);
    expect(s.sentTo(666)[0]!.text).toBe('Convite inválido ou expirado.');
  });

  it('a Telegram that already has an account is told so and the invite stays active', async () => {
    const s = setup();
    const code = await invite(s);
    await s.say(PLAIN_CHAT, `/start ${code}`);
    expect(s.sentTo(PLAIN_CHAT)[0]!.text).toBe('Este Telegram já está ligado a uma conta.');
    expect(s.fakes.invites.rows()[0]!.usedAt).toBeNull();
  });

  it('unknown, expired and revoked codes get the same single message', async () => {
    const s = setup();
    s.fakes.invites.seed({ code: 'EEEEEEEEEEEE', expiresAt: new Date(NOW.getTime() - 1000) });
    await s.say(GUEST_CHAT, '/start ZZZZZZZZZZZZ');
    await s.say(GUEST_CHAT, '/start EEEEEEEEEEEE');
    expect(s.sentTo(GUEST_CHAT).map((m) => m.text)).toEqual(['Convite inválido ou expirado.', 'Convite inválido ou expirado.']);
  });

  it('too many invalid attempts from one chat are throttled', async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) await s.say(GUEST_CHAT, '/start ZZZZZZZZZZZZ');
    await s.say(GUEST_CHAT, '/start ZZZZZZZZZZZZ');
    expect(s.sentTo(GUEST_CHAT).at(-1)!.text).toBe('Muitas tentativas. Tente de novo em alguns minutos.');
  });

  it('an infrastructure failure gets a retry message and gives the invite back', async () => {
    const s = setup();
    const code = await invite(s);
    s.fakes.accounts.failCreateWith = new Error('auth caiu');
    await s.say(GUEST_CHAT, `/start ${code}`);
    expect(s.sentTo(GUEST_CHAT)[0]!.text).toMatch(/Não consegui criar a conta agora/);
    expect(s.logs).toContain('telegram.invite_accept_failed');
    s.fakes.accounts.failCreateWith = null;
    await s.say(GUEST_CHAT, `/start ${code}`);
    expect(s.sentTo(GUEST_CHAT)[1]!.text).toBe('Pronto, sua conta foi criada.');
  });

  it('the 8-char link code path is untouched', async () => {
    const s = setup();
    await s.say(GUEST_CHAT, '/start ABCD2345');
    expect(s.sentTo(GUEST_CHAT)[0]!.text).toBe('Código inválido ou vencido. Gere outro no painel.');
  });

  it('with invites off a 12-char code is just invalid', async () => {
    const s = setup({ withInvites: false });
    await s.say(GUEST_CHAT, '/start ABCDEFGHJKMN');
    expect(s.sentTo(GUEST_CHAT)[0]!.text).toBe('Convite inválido ou expirado.');
  });
});
