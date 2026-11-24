import { describe, expect, it } from 'vitest';
import { createFakes } from '../../test/fakes.js';
import { ChatAlreadyLinkedError, ConflictError, ForbiddenError, NotFoundError } from './errors.js';
import { computeInviteStatus, makeAcceptInvite, makeInviteUseCases } from './invites.js';

const NOW = new Date('2026-11-04T12:00:00.000Z');
const ADMIN_CHAT = 111;

function setup(opts: { admins?: number[]; ttlDays?: number } = {}) {
  const f = createFakes({ now: NOW });
  f.links.setChat('admin', ADMIN_CHAT);
  f.links.setChat('plain', 222);
  const uc = makeInviteUseCases({
    invites: f.invites,
    accounts: f.accounts,
    adminTelegramIds: new Set(opts.admins ?? [ADMIN_CHAT]),
    botUsername: 'nexus_bot',
    clock: f.clock,
    ...(opts.ttlDays !== undefined ? { ttlDays: opts.ttlDays } : {}),
  });
  const accept = makeAcceptInvite({ invites: f.invites, accounts: f.accounts, links: f.links, clock: f.clock });
  return { f, uc, accept };
}

describe('invite creation', () => {
  it('admin gets a 12-char code, the deep link and 7 days of validity', async () => {
    const { uc } = setup();
    const dto = await uc.create('admin');
    expect(dto.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/);
    expect(dto.link).toBe(`https://t.me/nexus_bot?start=${dto.code}`);
    expect(dto.status).toBe('ativo');
    expect(dto.expiresAt).toBe('2026-11-11T12:00:00.000Z');
    expect(dto.usedAt).toBeNull();
  });

  it('validity follows the configured days', async () => {
    const { uc } = setup({ ttlDays: 1 });
    expect((await uc.create('admin')).expiresAt).toBe('2026-11-05T12:00:00.000Z');
  });

  it('a user whose Telegram is not an admin id is forbidden', async () => {
    const { uc } = setup();
    await expect(uc.create('plain')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(uc.list('plain')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(uc.revoke('plain', 'ABCDEFGHJKMN')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('an account with no linked Telegram is forbidden even if the list is non-empty', async () => {
    const { f, uc } = setup();
    f.links.setChat('admin', null);
    await expect(uc.create('admin')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('an empty admin list means nobody administers', async () => {
    const { uc } = setup({ admins: [] });
    await expect(uc.create('admin')).rejects.toBeInstanceOf(ForbiddenError);
    expect(uc.isAdminChat(ADMIN_CHAT)).toBe(false);
  });

  it('isAdmin answers without throwing', async () => {
    const { uc } = setup();
    expect(await uc.isAdmin('admin')).toBe(true);
    expect(await uc.isAdmin('plain')).toBe(false);
    expect(uc.isAdminChat(ADMIN_CHAT)).toBe(true);
    expect(uc.isAdminChat(222)).toBe(false);
  });

  it('retries with a new code on a collision', async () => {
    const { f, uc } = setup();
    // 12 bytes of zeros = AAAAAAAAAAAA; a second call gets bytes that make another code.
    const calls: number[][] = [new Array(12).fill(0), new Array(12).fill(0), new Array(12).fill(1)];
    let i = 0;
    const uc2 = makeInviteUseCases({
      invites: f.invites,
      accounts: f.accounts,
      adminTelegramIds: new Set([ADMIN_CHAT]),
      botUsername: 'nexus_bot',
      clock: f.clock,
      randomBytes: () => Uint8Array.from(calls[Math.min(i++, calls.length - 1)]!),
    });
    await uc2.create('admin');
    const second = await uc2.create('admin');
    expect(second.code).toBe('BBBBBBBBBBBB');
    expect(uc).toBeDefined();
  });
});

describe('invite list and revoke', () => {
  it('lists newest first with the computed status', async () => {
    const { f, uc } = setup();
    f.invites.seed({ code: 'AAAAAAAAAAAA', createdAt: new Date('2026-11-01T00:00:00Z'), expiresAt: new Date('2026-11-03T00:00:00Z') });
    f.invites.seed({ code: 'BBBBBBBBBBBB', createdAt: new Date('2026-11-02T00:00:00Z'), usedAt: new Date('2026-11-03T00:00:00Z') });
    f.invites.seed({ code: 'CCCCCCCCCCCC', createdAt: new Date('2026-11-03T00:00:00Z'), revokedAt: new Date('2026-11-03T10:00:00Z') });
    const created = await uc.create('admin');
    const list = await uc.list('admin');
    expect(list.map((i) => [i.code, i.status])).toEqual([
      [created.code, 'ativo'],
      ['CCCCCCCCCCCC', 'revogado'],
      ['BBBBBBBBBBBB', 'usado'],
      ['AAAAAAAAAAAA', 'expirado'],
    ]);
  });

  it('revokes an active invite, and a second revoke is a 404', async () => {
    const { uc } = setup();
    const { code } = await uc.create('admin');
    await uc.revoke('admin', code);
    await expect(uc.revoke('admin', code)).rejects.toBeInstanceOf(NotFoundError);
    expect((await uc.list('admin'))[0]!.status).toBe('revogado');
  });

  it('cannot revoke an invite that was already used', async () => {
    const { f, uc } = setup();
    f.invites.seed({ code: 'DDDDDDDDDDDD', usedAt: NOW });
    await expect(uc.revoke('admin', 'DDDDDDDDDDDD')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('invite removal', () => {
  it('deleting an active invite removes it and blocks nobody', async () => {
    const { f, uc } = setup();
    const { code } = await uc.create('admin');
    await uc.remove('admin', code);
    expect(await uc.list('admin')).toEqual([]);
    expect(f.accounts.blocked).toEqual([]);
  });

  it('deleting a used invite blocks the guest account and unlinks their Telegram', async () => {
    const { f, uc, accept } = setup();
    const { code } = await uc.create('admin');
    const result = await accept(code, 555);
    if (result.status !== 'criada') throw new Error('esperava conta criada');
    await uc.remove('admin', code);
    expect(f.accounts.blocked).toEqual([result.userId]);
    expect(await f.links.userForChat(555)).toBeNull();
    expect(await uc.list('admin')).toEqual([]);
  });

  it('never blocks the administrator or another administrator through an invite', async () => {
    const { f, uc } = setup({ admins: [ADMIN_CHAT, 333] });
    f.links.setChat('other-admin', 333);
    f.invites.seed({ code: 'EEEEEEEEEEEE', usedAt: NOW, usedBy: 'other-admin' });
    f.invites.seed({ code: 'FFFFFFFFFFFF', usedAt: NOW, usedBy: 'admin' });
    await expect(uc.remove('admin', 'EEEEEEEEEEEE')).rejects.toBeInstanceOf(ConflictError);
    await expect(uc.remove('admin', 'FFFFFFFFFFFF')).rejects.toBeInstanceOf(ConflictError);
    expect(f.accounts.blocked).toEqual([]);
    expect(f.invites.rows()).toHaveLength(2);
  });

  it('unknown code is 404 and a non-administrator is forbidden', async () => {
    const { uc } = setup();
    await expect(uc.remove('admin', 'ABCDEFGHJKMN')).rejects.toBeInstanceOf(NotFoundError);
    await expect(uc.remove('plain', 'ABCDEFGHJKMN')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('summary counts every status', async () => {
    const { f, uc } = setup();
    f.invites.seed({ code: 'AAAAAAAAAAAA', expiresAt: new Date('2026-11-03T00:00:00Z'), createdAt: new Date('2026-11-01T00:00:00Z') });
    f.invites.seed({ code: 'BBBBBBBBBBBB', usedAt: NOW });
    f.invites.seed({ code: 'CCCCCCCCCCCC', revokedAt: NOW });
    await uc.create('admin');
    expect(await uc.summary('admin')).toEqual({ total: 4, ativos: 1, usados: 1, expirados: 1, revogados: 1 });
  });
});

describe('computeInviteStatus', () => {
  it('prioritises used, then revoked, then expired', () => {
    const base = { code: 'X', createdBy: 'a', createdAt: NOW, expiresAt: new Date(NOW.getTime() - 1), revokedAt: NOW, usedAt: NOW };
    expect(computeInviteStatus(base, NOW)).toBe('usado');
    expect(computeInviteStatus({ ...base, usedAt: null }, NOW)).toBe('revogado');
    expect(computeInviteStatus({ ...base, usedAt: null, revokedAt: null }, NOW)).toBe('expirado');
    expect(computeInviteStatus({ ...base, usedAt: null, revokedAt: null, expiresAt: new Date(NOW.getTime() + 1) }, NOW)).toBe('ativo');
  });
});

describe('accepting an invite', () => {
  it('creates the account, links the chat and marks the invite used', async () => {
    const { f, uc, accept } = setup();
    const { code } = await uc.create('admin');
    const result = await accept(code, 555);
    expect(result.status).toBe('criada');
    expect(f.links.chatFor('invited-1')).toBe(555);
    expect(await f.links.userForChat(555)).toBe('invited-1');
    expect((await uc.list('admin'))[0]!.status).toBe('usado');
  });

  it('a used invite cannot be used again', async () => {
    const { uc, accept } = setup();
    const { code } = await uc.create('admin');
    await accept(code, 555);
    expect(await accept(code, 666)).toEqual({ status: 'invalido' });
  });

  it('unknown, expired and revoked codes all look the same', async () => {
    const { f, uc, accept } = setup();
    f.invites.seed({ code: 'EEEEEEEEEEEE', expiresAt: new Date(NOW.getTime() - 1000) });
    const revoked = await uc.create('admin');
    await uc.revoke('admin', revoked.code);
    expect(await accept('FFFFFFFFFFFF', 555)).toEqual({ status: 'invalido' });
    expect(await accept('EEEEEEEEEEEE', 555)).toEqual({ status: 'invalido' });
    expect(await accept(revoked.code, 555)).toEqual({ status: 'invalido' });
    expect(f.accounts.created).toEqual([]);
  });

  it('two people racing for the same code: exactly one gets an account', async () => {
    const { f, uc, accept } = setup();
    const { code } = await uc.create('admin');
    const results = await Promise.all([accept(code, 555), accept(code, 666), accept(code, 777)]);
    expect(results.filter((r) => r.status === 'criada')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'invalido')).toHaveLength(2);
    expect(f.accounts.created).toHaveLength(1);
  });

  it('a Telegram that already has an account does not spend the invite', async () => {
    const { f, uc, accept } = setup();
    const { code } = await uc.create('admin');
    expect(await accept(code, 222)).toEqual({ status: 'ja_vinculado' });
    expect(f.accounts.created).toEqual([]);
    expect((await uc.list('admin'))[0]!.status).toBe('ativo');
    expect(await accept(code, 555)).toMatchObject({ status: 'criada' });
  });

  it('a failure after the claim gives the code back and removes the account this attempt created', async () => {
    const { f, uc, accept } = setup();
    const { code } = await uc.create('admin');
    f.accounts.failLinkWith = new Error('db caiu');
    await expect(accept(code, 555)).rejects.toThrow('db caiu');
    expect(f.accounts.removed).toEqual(['invited-1']);
    expect((await uc.list('admin'))[0]!.status).toBe('ativo');
    f.accounts.failLinkWith = null;
    expect(await accept(code, 555)).toMatchObject({ status: 'criada' });
  });

  it('a chat taken by another account in the meantime is reported as already linked and the code is returned', async () => {
    const { f, uc, accept } = setup();
    const { code } = await uc.create('admin');
    f.accounts.failLinkWith = new ChatAlreadyLinkedError();
    expect(await accept(code, 555)).toEqual({ status: 'ja_vinculado' });
    expect((await uc.list('admin'))[0]!.status).toBe('ativo');
  });

  it('account creation failing returns the code and creates nothing', async () => {
    const { f, uc, accept } = setup();
    const { code } = await uc.create('admin');
    f.accounts.failCreateWith = new Error('auth caiu');
    await expect(accept(code, 555)).rejects.toThrow('auth caiu');
    expect(f.accounts.removed).toEqual([]);
    expect((await uc.list('admin'))[0]!.status).toBe('ativo');
  });
});
