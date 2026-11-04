import { createHash, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/compose.js';
import { createSupabaseQrLoginRepository } from '../../src/infra/supabase-qr-login-repository.js';
import { createFakes } from '../fakes.js';
import { asAnon, asUser, closePool, createUser, deleteCreatedUsers, pool } from './helpers.js';
import { getSupabaseEnv } from './supabase-env.js';

// Login do painel por QR contra o Supabase local, com o Telegram FALSO (nenhuma mensagem real sai):
// tabela fechada, estados atômicos e a jornada completa até uma sessão real.

const TOKEN = '123456:TEST-token-not-real';
const SECRET = 'segredo-do-webhook-16chars';
const WEB_ORIGIN = 'http://localhost:3000';
const MAILBOX = 'http://127.0.0.1:55324/api/v1';
const DENIED = { code: '42501' };

const env = getSupabaseEnv();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin: SupabaseClient = createClient(env.url, env.serviceRoleKey, opts);
const repo = createSupabaseQrLoginRepository(admin);

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const base = 9_000_000_000 + Math.floor(Math.random() * 100_000_000);

let now = new Date('2026-11-04T15:00:00.000Z');
const fakes = createFakes({ now });
const app = buildApp(
  {
    supabaseUrl: env.url,
    serviceRoleKey: env.serviceRoleKey,
    port: 0,
    webOrigin: WEB_ORIGIN,
    assistantModel: 'x',
    telegramBotToken: TOKEN,
    telegramBotUsername: 'nexus_bot',
    telegramWebhookSecret: SECRET,
  },
  { clock: { now: () => now }, telegramClient: fakes.telegram },
);

const authUserIds: string[] = [];
async function linkedUser(telegramId: number): Promise<{ id: string; email: string }> {
  const email = `qr-${randomUUID()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: `pw-${randomUUID()}`, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  authUserIds.push(data.user.id);
  await pool.query('update public.profiles set telegram_chat_id = $1 where id = $2', [telegramId, data.user.id]);
  return { id: data.user.id, email };
}

let updateId = 6_000_000 + Math.floor(Math.random() * 1_000_000);
const webhook = (body: Record<string, unknown>) =>
  app.request('/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    body: JSON.stringify({ update_id: updateId++, ...body }),
  });
const sendStart = (chatId: number, param: string) =>
  webhook({ message: { message_id: 1, chat: { id: chatId, type: 'private' }, text: `/start ${param}` } });
const tap = (chatId: number, data: string, messageId = 500) =>
  webhook({ callback_query: { id: `cb-${randomUUID()}`, data, message: { message_id: messageId, chat: { id: chatId, type: 'private' } } } });
const repliesTo = (chatId: number) => fakes.telegram.sent.filter((m) => m.chatId === chatId);

const createdIds: string[] = [];
const createRequest = async (ua = 'Mozilla/5.0 (Macintosh) Chrome/126.0 Safari/537.36') => {
  const res = await app.request('/auth/qr', { method: 'POST', headers: { origin: WEB_ORIGIN, 'user-agent': ua, 'x-forwarded-for': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { id: string; pollSecret: string; deepLink: string; expiresAt: string };
  createdIds.push(created.id);
  return { ...created, nonce: created.deepLink.split('start=')[1]!.replace('login_', '') };
};
const poll = (id: string, secret: string | undefined) =>
  app.request(`/auth/qr/${id}`, { headers: { origin: WEB_ORIGIN, ...(secret !== undefined ? { 'x-poll-secret': secret } : {}) } });

async function mailCount(): Promise<number> {
  const res = await fetch(`${MAILBOX}/messages?limit=1`);
  return ((await res.json()) as { messages_count: number }).messages_count;
}

afterAll(async () => {
  await pool.query(`delete from public.qr_login_requests where client_label like 'TESTE-%' or id = any($1::uuid[])`, [createdIds]);
  for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
  await deleteCreatedUsers();
  await closePool();
});

describe('qr_login_requests: acesso', () => {
  it('anon e authenticated não leem, escrevem nem chamam as funções; só a API (service_role) usa', async () => {
    const id = randomUUID();
    await repo.create({ id, nonceHash: sha(randomUUID()), pollHash: sha(randomUUID()), clientLabel: 'TESTE-acesso', createdAt: now, expiresAt: new Date(now.getTime() + 180_000) });
    const user = await createUser();
    await expect(asAnon((q) => q('select id from public.qr_login_requests'))).rejects.toMatchObject(DENIED);
    await expect(asUser(user, (q) => q('select id from public.qr_login_requests'))).rejects.toMatchObject(DENIED);
    await expect(
      asUser(user, (q) => q(`select * from public.open_qr_login($1, 1, $2, now())`, [sha('x'), user])),
    ).rejects.toMatchObject(DENIED);
    await expect(asUser(user, (q) => q(`select public.consume_qr_login($1, $2, now())`, [id, sha('x')]))).rejects.toMatchObject(DENIED);
    await expect(asAnon((q) => q(`select public.purge_qr_login_requests(now())`))).rejects.toMatchObject(DENIED);
    expect(await repo.get(id)).not.toBeNull();
  });

  it('os segredos só entram como hash hex de 64 caracteres, e o rótulo tem limite', async () => {
    const bad = (patch: Partial<Parameters<typeof repo.create>[0]>) =>
      repo.create({ id: randomUUID(), nonceHash: sha(randomUUID()), pollHash: sha(randomUUID()), clientLabel: 'TESTE-c', createdAt: now, expiresAt: new Date(now.getTime() + 1000), ...patch });
    await expect(bad({ nonceHash: 'texto-puro' })).rejects.toThrow();
    await expect(bad({ pollHash: 'abc' })).rejects.toThrow();
    await expect(bad({ clientLabel: 'x'.repeat(61) })).rejects.toThrow();
    await expect(bad({ expiresAt: new Date(now.getTime() - 1000) })).rejects.toThrow();
    const nonceHash = sha(randomUUID());
    await bad({ nonceHash, clientLabel: 'TESTE-unico' });
    await expect(bad({ nonceHash })).rejects.toThrow(); // o nonce é único
  });
});

describe('qr_login_requests: estados atômicos', () => {
  async function fresh(ttlMs = 180_000) {
    const nonce = randomUUID();
    const poll = randomUUID();
    const id = randomUUID();
    await repo.create({ id, nonceHash: sha(nonce), pollHash: sha(poll), clientLabel: 'TESTE-estado', createdAt: now, expiresAt: new Date(now.getTime() + ttlMs) });
    return { id, nonceHash: sha(nonce), pollHash: sha(poll) };
  }

  it('open só vale uma vez, só enquanto aguardando e não vencido', async () => {
    const user = await linkedUser(base + 1);
    const r = await fresh();
    const first = await repo.open(r.nonceHash, base + 1, user.id, now);
    expect(first).toMatchObject({ id: r.id, outcome: 'confirmar', clientLabel: 'TESTE-estado' });
    expect(await repo.open(r.nonceHash, base + 2, user.id, now)).toBeNull();
    const old = await fresh(1000);
    expect(await repo.open(old.nonceHash, base + 1, user.id, new Date(now.getTime() + 5000))).toBeNull();
    expect(await repo.open(sha('nunca existiu'), base + 1, user.id, now)).toBeNull();
  });

  it('sem conta o pedido vira recusado e nunca pode ser aprovado', async () => {
    const r = await fresh();
    expect(await repo.open(r.nonceHash, base + 3, null, now)).toMatchObject({ outcome: 'recusado' });
    expect(await repo.get(r.id)).toMatchObject({ status: 'recusado' });
    expect(await repo.decide(r.id, base + 3, randomUUID(), true, now)).toBeNull();
  });

  it('decide só para o chat e a conta do pedido, uma vez, antes de vencer', async () => {
    const user = await linkedUser(base + 4);
    const other = await linkedUser(base + 5);
    const r = await fresh();
    await repo.open(r.nonceHash, base + 4, user.id, now);
    expect(await repo.decide(r.id, base + 5, user.id, true, now)).toBeNull(); // outro chat
    expect(await repo.decide(r.id, base + 4, other.id, true, now)).toBeNull(); // outra conta
    expect(await repo.decide(r.id, base + 4, user.id, true, new Date(now.getTime() + 200_000))).toBeNull(); // vencido
    expect(await repo.decide(r.id, base + 4, user.id, false, now)).toBe('negado');
    expect(await repo.decide(r.id, base + 4, user.id, true, now)).toBeNull(); // já decidido
    expect(await repo.get(r.id)).toMatchObject({ status: 'negado' });
  });

  it('consume entrega o usuário uma única vez, só com o segredo certo, mesmo com chamadas simultâneas', async () => {
    const user = await linkedUser(base + 6);
    const r = await fresh();
    await repo.open(r.nonceHash, base + 6, user.id, now);
    expect(await repo.consume(r.id, r.pollHash, now)).toBeNull(); // ainda não aprovado
    await repo.decide(r.id, base + 6, user.id, true, now);
    expect(await repo.consume(r.id, sha('segredo errado'), now)).toBeNull();
    const results = await Promise.all(Array.from({ length: 8 }, () => repo.consume(r.id, r.pollHash, now)));
    expect(results.filter((u) => u === user.id)).toHaveLength(1);
    expect(results.filter((u) => u === null)).toHaveLength(7);
    expect(await repo.get(r.id)).toMatchObject({ status: 'consumido' });
  });

  it('release devolve um consumido a aprovado; aprovado vencido não é consumido', async () => {
    const user = await linkedUser(base + 7);
    const r = await fresh();
    await repo.open(r.nonceHash, base + 7, user.id, now);
    await repo.decide(r.id, base + 7, user.id, true, now);
    expect(await repo.consume(r.id, r.pollHash, now)).toBe(user.id);
    await repo.release(r.id);
    expect(await repo.get(r.id)).toMatchObject({ status: 'aprovado' });
    expect(await repo.consume(r.id, r.pollHash, new Date(now.getTime() + 200_000))).toBeNull();
  });

  it('a limpeza apaga só os vencidos há mais de dez minutos, e apagar a conta apaga o pedido', async () => {
    const user = await linkedUser(base + 8);
    const gone = await fresh(1000);
    const recent = await fresh(1000);
    const age = (id: string, expiredMinutesAgo: number) =>
      pool.query(`update public.qr_login_requests set created_at = $2, expires_at = $3 where id = $1`, [
        id,
        new Date(now.getTime() - (expiredMinutesAgo + 5) * 60_000),
        new Date(now.getTime() - expiredMinutesAgo * 60_000),
      ]);
    await age(gone.id, 11);
    await age(recent.id, 5);
    expect(await repo.purgeExpired(now)).toBeGreaterThanOrEqual(1);
    expect(await repo.get(gone.id)).toBeNull();
    expect(await repo.get(recent.id)).not.toBeNull();

    const mine = await fresh();
    await repo.open(mine.nonceHash, base + 8, user.id, now);
    await admin.auth.admin.deleteUser(user.id);
    expect(await repo.get(mine.id)).toBeNull();
  });
});

describe('login do painel por QR: jornada completa (Supabase local)', () => {
  it('QR, pergunta no bot, Confirmar e uma sessão real da conta certa, sem enviar e-mail', async () => {
    const user = await linkedUser(base + 20);
    const mailsBefore = await mailCount();
    const created = await createRequest();
    expect(await (await poll(created.id, created.pollSecret)).json()).toMatchObject({ status: 'aguardando' });

    await sendStart(base + 20, `login_${created.nonce}`);
    const ask = repliesTo(base + 20).at(-1)!;
    expect(ask.text).toContain('Entrar no painel do Nexus pelo navegador?');
    expect(ask.text).toContain('Chrome em macOS');
    const confirm = ask.keyboard![0]![0]! as { callbackData: string };
    expect(await (await poll(created.id, created.pollSecret)).json()).toMatchObject({ status: 'confirmar' });

    await tap(base + 20, confirm.callbackData);
    const done = (await (await poll(created.id, created.pollSecret)).json()) as { status: string; tokenHash: string };
    expect(done.status).toBe('aprovado');

    const anon = createClient(env.url, env.anonKey, opts);
    const { data, error } = await anon.auth.verifyOtp({ token_hash: done.tokenHash, type: 'magiclink' });
    expect(error).toBeNull();
    expect(data.user?.id).toBe(user.id);
    const me = await app.request('/me', { headers: { authorization: `Bearer ${data.session?.access_token}` } });
    expect(await me.json()).toEqual({ userId: user.id });
    const tasks = await app.request('/tasks', { headers: { authorization: `Bearer ${data.session?.access_token}` } });
    expect(tasks.status).toBe(200);

    // Segundo recolhimento: nada de token de novo
    const again = await poll(created.id, created.pollSecret);
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual({ error: 'ja_utilizado' });
    expect(await mailCount()).toBe(mailsBefore);
  });

  it('"Não fui eu" nega, e quem não tem o segredo nunca recebe nada', async () => {
    await linkedUser(base + 21);
    const created = await createRequest();
    await sendStart(base + 21, `login_${created.nonce}`);
    const deny = repliesTo(base + 21).at(-1)!.keyboard![0]![1]! as { callbackData: string };
    await tap(base + 21, deny.callbackData);
    expect(await (await poll(created.id, created.pollSecret)).json()).toMatchObject({ status: 'negado' });
    expect(fakes.telegram.edits.at(-1)!.text).toBe('Tudo certo, o acesso foi bloqueado.');
    expect((await poll(created.id, 'x'.repeat(43))).status).toBe(404);
    expect((await poll(created.id, undefined)).status).toBe(404);
  });

  it('Telegram sem conta é recusado e o navegador vê "recusado"', async () => {
    const created = await createRequest();
    await sendStart(base + 22, `login_${created.nonce}`);
    expect(repliesTo(base + 22).at(-1)!.text).toBe('Este Telegram ainda não tem acesso ao Nexus. Peça um convite.');
    expect(await (await poll(created.id, created.pollSecret)).json()).toMatchObject({ status: 'recusado' });
  });

  it('um pedido aprovado mas vencido não entrega sessão', async () => {
    await linkedUser(base + 23);
    const created = await createRequest();
    await sendStart(base + 23, `login_${created.nonce}`);
    const confirm = repliesTo(base + 23).at(-1)!.keyboard![0]![0]! as { callbackData: string };
    await tap(base + 23, confirm.callbackData);
    const saved = now;
    now = new Date(saved.getTime() + 4 * 60_000);
    try {
      expect(await (await poll(created.id, created.pollSecret)).json()).toMatchObject({ status: 'expirado' });
    } finally {
      now = saved;
    }
  });

  it('só o chat dono do pedido aprova: o de outra conta vinculada não consegue', async () => {
    await linkedUser(base + 24);
    await linkedUser(base + 25);
    const created = await createRequest();
    await sendStart(base + 24, `login_${created.nonce}`);
    const confirm = repliesTo(base + 24).at(-1)!.keyboard![0]![0]! as { callbackData: string };
    await tap(base + 25, confirm.callbackData);
    expect(await (await poll(created.id, created.pollSecret)).json()).toMatchObject({ status: 'confirmar' });
  });

  it('o preflight do navegador libera o X-Poll-Secret só para a origem do painel', async () => {
    const res = await app.request('/auth/qr/' + randomUUID(), {
      method: 'OPTIONS',
      headers: { origin: WEB_ORIGIN, 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-poll-secret' },
    });
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('x-poll-secret');
  });
});
