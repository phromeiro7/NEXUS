import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeAcceptInvite, makeInviteUseCases } from '../../src/application/invites.js';
import { createSupabaseAccountProvisioner, syntheticEmail } from '../../src/infra/supabase-account-provisioner.js';
import { createSupabaseInviteRepository } from '../../src/infra/supabase-invite-repository.js';
import { createSupabaseLinkRepository } from '../../src/infra/supabase-link-repository.js';
import { asAnon, asUser, closePool, createUser, deleteCreatedUsers, pool } from './helpers.js';
import { getSupabaseEnv } from './supabase-env.js';

const DENIED = { code: '42501' };
const env = getSupabaseEnv();
const admin = createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const invites = createSupabaseInviteRepository(admin);
const accounts = createSupabaseAccountProvisioner(admin);
const links = createSupabaseLinkRepository(admin);

const NOW = new Date('2026-11-04T12:00:00.000Z');
const LATER = new Date('2026-11-11T12:00:00.000Z');
const clock = { now: () => NOW };
const code = () => {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 12 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
};
/** Id do Telegram só para este arquivo (positivo, longe de ids reais). */
const tgId = () => 9_000_000_000 + Math.floor(Math.random() * 900_000_000);

const createdAccounts: string[] = [];
let ADMIN_USER = '';
const ADMIN_TG = tgId();

beforeAll(async () => {
  ADMIN_USER = await createUser();
  await pool.query(`update public.profiles set telegram_chat_id = $2 where id = $1`, [ADMIN_USER, ADMIN_TG]);
});

afterAll(async () => {
  for (const id of createdAccounts) await admin.auth.admin.deleteUser(id);
  await deleteCreatedUsers();
  await closePool();
});

describe('invites: access', () => {
  it('anon and authenticated clients cannot read or write the table or call its functions', async () => {
    const c = code();
    await invites.create(ADMIN_USER, c, NOW, LATER);
    await expect(asAnon((q) => q(`select code from public.invites`))).rejects.toMatchObject(DENIED);
    await expect(asUser(ADMIN_USER, (q) => q(`select code from public.invites`))).rejects.toMatchObject(DENIED);
    await expect(
      asUser(ADMIN_USER, (q) => q(`insert into public.invites (code, created_by, expires_at) values ($1, $2, now() + interval '1 day')`, [code(), ADMIN_USER])),
    ).rejects.toMatchObject(DENIED);
    await expect(asUser(ADMIN_USER, (q) => q(`select public.claim_invite($1, now())`, [c]))).rejects.toMatchObject(DENIED);
    await expect(asAnon((q) => q(`select public.claim_invite($1, now())`, [c]))).rejects.toMatchObject(DENIED);
  });

  it('rejects malformed codes and an expiry that is not after creation', async () => {
    await expect(pool.query(`insert into public.invites (code, created_by, expires_at) values ('curto', $1, now() + interval '1 day')`, [ADMIN_USER])).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(`insert into public.invites (code, created_by, created_at, expires_at) values ($2, $1, now(), now() - interval '1 day')`, [ADMIN_USER, code()])).rejects.toMatchObject({ code: '23514' });
  });
});

describe('invites: repository', () => {
  it('claims once, only before expiry, and release / finish follow the state machine', async () => {
    const c = code();
    await invites.create(ADMIN_USER, c, NOW, LATER);
    expect(await invites.claim(c, new Date('2026-11-12T00:00:00Z'))).toBe(false); // vencido
    expect(await invites.claim(c, NOW)).toBe(true);
    expect(await invites.claim(c, NOW)).toBe(false); // já reservado
    await invites.release(c);
    expect(await invites.claim(c, NOW)).toBe(true);
    expect(await invites.finish(c, ADMIN_USER, NOW)).toBe(true);
    expect(await invites.finish(c, ADMIN_USER, NOW)).toBe(false);
    await invites.release(c); // usado: não devolve
    expect(await invites.claim(c, NOW)).toBe(false);
  });

  it('a revoked invite cannot be claimed and a used one cannot be revoked', async () => {
    const a = code();
    const b = code();
    await invites.create(ADMIN_USER, a, NOW, LATER);
    await invites.create(ADMIN_USER, b, NOW, LATER);
    expect(await invites.revoke(a, NOW)).toBe(true);
    expect(await invites.revoke(a, NOW)).toBe(false);
    expect(await invites.claim(a, NOW)).toBe(false);
    await invites.claim(b, NOW);
    await invites.finish(b, ADMIN_USER, NOW);
    expect(await invites.revoke(b, NOW)).toBe(false);
  });

  it('50 simultaneous claims of one code: exactly one wins', async () => {
    const c = code();
    await invites.create(ADMIN_USER, c, NOW, LATER);
    const results = await Promise.all(Array.from({ length: 50 }, () => invites.claim(c, NOW)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('reads the linked Telegram id of an account', async () => {
    expect(await invites.telegramIdOf(ADMIN_USER)).toBe(ADMIN_TG);
    expect(await invites.telegramIdOf(randomUUID())).toBeNull();
  });
});

describe('invites: end to end with a real account', () => {
  const useCases = makeInviteUseCases({ invites, accounts, adminTelegramIds: new Set([ADMIN_TG]), botUsername: 'nexus_bot', clock });
  const accept = makeAcceptInvite({ invites, accounts, links, clock });

  it('Auth refuses a user with no e-mail and no phone (why the synthetic e-mail exists)', async () => {
    const { error } = await admin.auth.admin.createUser({});
    expect(error).not.toBeNull();
  });

  it('creates the account without a password or e-mail, with default profile and settings, and links the chat', async () => {
    const invite = await useCases.create(ADMIN_USER);
    const guest = tgId();
    const result = await accept(invite.code, guest);
    expect(result.status).toBe('criada');
    const userId = (result as { userId: string }).userId;
    createdAccounts.push(userId);

    const found = await admin.auth.admin.getUserById(userId);
    expect(found.data.user?.email).toBe(syntheticEmail(guest));
    expect(found.data.user?.email_confirmed_at).toBeTruthy();
    const { rows } = await pool.query(
      `select telegram_chat_id::text as chat, timezone, early_reminder_minutes, channel_paused from public.profiles where id = $1`,
      [userId],
    );
    expect(rows[0]).toEqual({ chat: String(guest), timezone: 'America/Sao_Paulo', early_reminder_minutes: 15, channel_paused: false });
    // Sem senha utilizável: entrar com senha vazia ou qualquer valor falha.
    const anon = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const attempt = await anon.auth.signInWithPassword({ email: syntheticEmail(guest), password: 'qualquer-coisa-123' });
    expect(attempt.error).not.toBeNull();
    expect((await useCases.list(ADMIN_USER)).find((i) => i.code === invite.code)!.status).toBe('usado');
    expect(await links.userForChat(guest)).toBe(userId);
  });

  it('after /desvincular the same Telegram returns to the same account with a new invite', async () => {
    const first = await useCases.create(ADMIN_USER);
    const guest = tgId();
    const a = (await accept(first.code, guest)) as { userId: string };
    createdAccounts.push(a.userId);
    await links.unlink(a.userId);
    const second = await useCases.create(ADMIN_USER);
    const b = (await accept(second.code, guest)) as { userId: string };
    expect(b.userId).toBe(a.userId);
    expect(await links.userForChat(guest)).toBe(a.userId);
  });

  it('two guests with one code: one account, the other is invalid', async () => {
    const invite = await useCases.create(ADMIN_USER);
    const results = await Promise.all([accept(invite.code, tgId()), accept(invite.code, tgId())]);
    for (const r of results) if (r.status === 'criada') createdAccounts.push(r.userId);
    expect(results.filter((r) => r.status === 'criada')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'invalido')).toHaveLength(1);
  });

  it('the account that already has the Telegram does not spend the invite', async () => {
    const invite = await useCases.create(ADMIN_USER);
    expect(await accept(invite.code, ADMIN_TG)).toEqual({ status: 'ja_vinculado' });
    expect((await useCases.list(ADMIN_USER)).find((i) => i.code === invite.code)!.status).toBe('ativo');
  });
});
