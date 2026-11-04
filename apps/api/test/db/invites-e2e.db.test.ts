import { createHmac, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { createFakes } from '../fakes.js';
import { buildApp } from '../../src/compose.js';
import { closePool, createUser, deleteCreatedUsers, pool } from './helpers.js';
import { getSupabaseEnv } from './supabase-env.js';

// Convites de ponta a ponta no Supabase local, com o Telegram FALSO (nenhuma mensagem real sai):
// administrador gera o convite pelo bot, o convidado aceita, a conta nasce vinculada e entra pelo initData.

const TOKEN = '123456:TEST-token-not-real';
const SECRET = 'segredo-do-webhook-16chars';
const WEB_ORIGIN = 'http://localhost:3000';
const MAILBOX = 'http://127.0.0.1:55324/api/v1';

const env = getSupabaseEnv();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin: SupabaseClient = createClient(env.url, env.serviceRoleKey, opts);

const base = 9_000_000_000 + Math.floor(Math.random() * 100_000_000);
const ADMIN_TG = base + 1;
const GUEST_TG = base + 2;
const LATE_TG = base + 3;

const now = new Date('2026-11-04T15:00:00.000Z');
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
    miniAppUrl: 'https://nexus.example.test',
    adminTelegramUserIds: [ADMIN_TG],
  },
  { clock: { now: () => now }, telegramClient: fakes.telegram },
);

let updateId = 5_000_000 + Math.floor(Math.random() * 1_000_000);
const say = (chatId: number, text: string) =>
  app.request('/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    body: JSON.stringify({ update_id: updateId++, message: { message_id: 1, chat: { id: chatId, type: 'private' }, text } }),
  });
const repliesTo = (chatId: number) => fakes.telegram.sent.filter((m) => m.chatId === chatId).map((m) => m.text);

const hashes: string[] = [];
function sign(telegramId: number): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(now.getTime() / 1000) - 5),
    query_id: `Q-${randomUUID()}`,
    user: JSON.stringify({ id: telegramId, first_name: 'Convidada' }),
  };
  const check = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = createHmac('sha256', key).update(check).digest('hex');
  hashes.push(hash);
  return new URLSearchParams({ ...fields, hash }).toString();
}
const login = (initData: string) =>
  app.request('/auth/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
    body: JSON.stringify({ initData }),
  });

async function mailCount(): Promise<number> {
  const res = await fetch(`${MAILBOX}/messages?limit=1`);
  return ((await res.json()) as { messages_count: number }).messages_count;
}

const createdAccounts: string[] = [];
let ADMIN_USER = '';

afterAll(async () => {
  if (hashes.length > 0) await pool.query('delete from public.telegram_auth_replays where hash = any($1::text[])', [hashes]);
  await pool.query('delete from public.invites where created_by = $1', [ADMIN_USER]);
  for (const id of createdAccounts) await admin.auth.admin.deleteUser(id);
  await deleteCreatedUsers();
  await closePool();
});

describe('invites end to end (Supabase local, fake Telegram)', () => {
  it('admin /convite -> guest /start CODE -> account linked -> initData login -> /tasks 200; reuse fails', async () => {
    ADMIN_USER = await createUser();
    await pool.query('update public.profiles set telegram_chat_id = $1 where id = $2', [ADMIN_TG, ADMIN_USER]);
    const mailsBefore = await mailCount();

    // 1. O administrador gera o convite pelo bot.
    expect((await say(ADMIN_TG, '/convite')).status).toBe(200);
    const created = repliesTo(ADMIN_TG).at(-1)!;
    const code = /start=([A-Z2-9]{12})/.exec(created)?.[1];
    expect(code).toBeDefined();
    expect(created).toMatch(/^Convite criado\. Vale por 7 dias e abre uma conta só\./);

    // 2. O convidado aceita.
    expect((await say(GUEST_TG, `/start ${code}`)).status).toBe(200);
    expect(repliesTo(GUEST_TG)).toEqual(['Pronto, sua conta foi criada.']);
    expect(fakes.telegram.sent.at(-1)!.keyboard).toEqual([[{ text: 'Abrir o Nexus', webAppUrl: 'https://nexus.example.test' }]]);

    const { rows } = await pool.query<{ id: string }>('select id from public.profiles where telegram_chat_id = $1', [GUEST_TG]);
    expect(rows).toHaveLength(1);
    const guestUser = rows[0]!.id;
    createdAccounts.push(guestUser);

    // 3. O convidado entra pelo Mini App com o initData assinado.
    const res = await login(sign(GUEST_TG));
    expect(res.status).toBe(200);
    const { tokenHash } = (await res.json()) as { tokenHash: string };
    const anon = createClient(env.url, env.anonKey, opts);
    const { data, error } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    expect(error).toBeNull();
    expect(data.user?.id).toBe(guestUser);
    const token = data.session!.access_token;
    expect((await app.request('/tasks', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect(await (await app.request('/me', { headers: { authorization: `Bearer ${token}` } })).json()).toEqual({ userId: guestUser });
    // A conta nova não é administradora.
    expect((await app.request('/invites', { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);

    // 4. O mesmo convite não serve a mais ninguém.
    await say(LATE_TG, `/start ${code}`);
    expect(repliesTo(LATE_TG)).toEqual(['Convite inválido ou expirado.']);
    expect((await pool.query('select 1 from public.profiles where telegram_chat_id = $1', [LATE_TG])).rowCount).toBe(0);

    // 5. Nenhum e-mail saiu em todo o caminho.
    expect(await mailCount()).toBe(mailsBefore);
  });

  it('the administrator reads and deletes invites over HTTP; a deleted invite is dead', async () => {
    const adminSession = await (async () => {
      const email = `${randomUUID()}@example.test`;
      const password = `pw-${randomUUID()}`;
      const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      createdAccounts.push(data.user!.id);
      await pool.query('update public.profiles set telegram_chat_id = $1 where id = $2', [ADMIN_TG + 1000, data.user!.id]);
      return { id: data.user!.id, email, password };
    })();
    // Este usuário NÃO está na lista de administradores: 403.
    const anon = createClient(env.url, env.anonKey, opts);
    const signed = await anon.auth.signInWithPassword({ email: adminSession.email, password: adminSession.password });
    const plainToken = signed.data.session!.access_token;
    expect((await app.request('/invites', { method: 'POST', headers: { authorization: `Bearer ${plainToken}` } })).status).toBe(403);

    // O administrador de verdade (Telegram na lista) cria e revoga.
    const adminEmail = `${randomUUID()}@example.test`;
    const adminPw = `pw-${randomUUID()}`;
    const { data: adm } = await admin.auth.admin.createUser({ email: adminEmail, password: adminPw, email_confirm: true });
    createdAccounts.push(adm.user!.id);
    await pool.query('update public.profiles set telegram_chat_id = null where telegram_chat_id = $1', [ADMIN_TG]);
    await pool.query('update public.profiles set telegram_chat_id = $1 where id = $2', [ADMIN_TG, adm.user!.id]);
    const s2 = await createClient(env.url, env.anonKey, opts).auth.signInWithPassword({ email: adminEmail, password: adminPw });
    const bearer = { authorization: `Bearer ${s2.data.session!.access_token}` };

    const made = await app.request('/invites', { method: 'POST', headers: bearer });
    expect(made.status).toBe(201);
    const invite = (await made.json()) as { code: string };
    expect((await app.request(`/invites/${invite.code}`, { method: 'DELETE', headers: bearer })).status).toBe(204);
    const list = (await (await app.request('/invites', { headers: bearer })).json()) as { invites: Array<{ code: string; status: string }> };
    expect(list.invites.find((i) => i.code === invite.code)).toBeUndefined();
    await say(base + 50, `/start ${invite.code}`);
    expect(repliesTo(base + 50)).toEqual(['Convite inválido ou expirado.']);
  });
});
