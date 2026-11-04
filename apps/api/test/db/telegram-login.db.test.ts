import { createHmac, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/compose.js';
import { closePool, pool } from './helpers.js';
import { getSupabaseEnv } from './supabase-env.js';

// Login do Mini App pelo initData contra o Supabase local: assinatura, vínculo, anti-reuso, sessão real e
// nenhum e-mail enviado.

const TOKEN = '123456:TEST-token-not-real';
const WEB_ORIGIN = 'http://localhost:3000';
const MAILBOX = 'http://127.0.0.1:55324/api/v1';

const env = getSupabaseEnv();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin: SupabaseClient = createClient(env.url, env.serviceRoleKey, opts);

let now = new Date('2026-11-04T15:00:00.000Z');
const app = buildApp(
  {
    supabaseUrl: env.url,
    serviceRoleKey: env.serviceRoleKey,
    port: 0,
    webOrigin: WEB_ORIGIN,
    assistantModel: 'x',
    telegramBotToken: TOKEN,
  },
  { clock: { now: () => now } },
);
const appWithoutBot = buildApp({
  supabaseUrl: env.url,
  serviceRoleKey: env.serviceRoleKey,
  port: 0,
  webOrigin: WEB_ORIGIN,
  assistantModel: 'x',
});

const authUserIds: string[] = [];
const hashes: string[] = [];

/** Um usuário real do Supabase Auth com o chat do Telegram vinculado (id do chat = id do Telegram). */
async function linkedUser(telegramId: number): Promise<{ id: string; email: string }> {
  const email = `tg-${randomUUID()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: `pw-${randomUUID()}`, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  authUserIds.push(data.user.id);
  await pool.query('update public.profiles set telegram_chat_id = $1 where id = $2', [telegramId, data.user.id]);
  return { id: data.user.id, email };
}

let seq = 0;
function sign(telegramId: number, authDate = Math.floor(now.getTime() / 1000) - 5): string {
  seq += 1;
  const fields: Record<string, string> = {
    auth_date: String(authDate),
    query_id: `Q${seq}-${randomUUID()}`,
    user: JSON.stringify({ id: telegramId, first_name: 'Teste' }),
  };
  const check = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  hashes.push(hash);
  return new URLSearchParams({ ...fields, hash }).toString();
}

const login = (initData: string, target = app) =>
  target.request('/auth/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
    body: JSON.stringify({ initData }),
  });

async function mailCount(): Promise<number> {
  const res = await fetch(`${MAILBOX}/messages?limit=1`);
  return ((await res.json()) as { messages_count: number }).messages_count;
}

// Ids do Telegram únicos por execução (a coluna é única e a base local é compartilhada com outras suítes).
const base = 9_000_000_000 + Math.floor(Math.random() * 100_000_000);

afterAll(async () => {
  if (hashes.length > 0) await pool.query('delete from public.telegram_auth_replays where hash = any($1::text[])', [hashes]);
  for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
  await closePool();
});

describe('POST /auth/telegram (Supabase local)', () => {
  it('troca o initData assinado por uma sessão real da conta vinculada, sem enviar e-mail', async () => {
    const user = await linkedUser(base + 1);
    const mailsBefore = await mailCount();

    const res = await login(sign(base + 1));
    expect(res.status).toBe(200);
    const { tokenHash } = (await res.json()) as { tokenHash: string };
    expect(tokenHash).toMatch(/\S{20,}/);

    // O cliente troca o token por sessão exatamente como o Mini App faz.
    const anon = createClient(env.url, env.anonKey, opts);
    const { data, error } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    expect(error).toBeNull();
    expect(data.user?.id).toBe(user.id);
    expect(data.session?.access_token).toBeTruthy();

    // A sessão vale na API: a mesma conta, e só ela.
    const me = await app.request('/me', { headers: { authorization: `Bearer ${data.session?.access_token}` } });
    expect(await me.json()).toEqual({ userId: user.id });

    expect(await mailCount()).toBe(mailsBefore);
  });

  it('o mesmo initData só abre uma sessão; o token de sessão também é de uso único', async () => {
    await linkedUser(base + 2);
    const data = sign(base + 2);
    const first = await login(data);
    expect(first.status).toBe(200);
    const second = await login(data);
    expect(second.status).toBe(401);
    expect(await second.json()).toEqual({ error: 'ja_utilizado' });

    const { tokenHash } = (await first.json()) as { tokenHash: string };
    const anon = createClient(env.url, env.anonKey, opts);
    expect((await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })).error).toBeNull();
    const again = await createClient(env.url, env.anonKey, opts).auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    expect(again.error).not.toBeNull();
  });

  it('Telegram sem conta vinculada: 403 e o initData continua utilizável depois de vincular', async () => {
    const data = sign(base + 3);
    const refused = await login(data);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: 'telegram_nao_vinculado' });
    expect(refused.headers.get('set-cookie')).toBeNull();

    await linkedUser(base + 3);
    expect((await login(data)).status).toBe(200);
  });

  it('cada Telegram abre a sessão da SUA conta, nunca a de outra', async () => {
    const a = await linkedUser(base + 4);
    const b = await linkedUser(base + 5);
    const sessionOf = async (telegramId: number) => {
      const { tokenHash } = (await (await login(sign(telegramId))).json()) as { tokenHash: string };
      const { data } = await createClient(env.url, env.anonKey, opts).auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
      return data.user?.id;
    };
    expect(await sessionOf(base + 4)).toBe(a.id);
    expect(await sessionOf(base + 5)).toBe(b.id);
  });

  it('recusa assinatura inválida, expirado e fora da janela sem tocar no banco', async () => {
    await linkedUser(base + 6);
    const before = await pool.query('select count(*)::int as n from public.telegram_auth_replays');
    const forged = sign(base + 6).replace(/hash=[0-9a-f]/, (m) => `${m.slice(0, -1)}${m.endsWith('0') ? '1' : '0'}`);
    expect(await (await login(forged)).json()).toEqual({ error: 'assinatura_invalida' });
    const expired = await login(sign(base + 6, Math.floor(now.getTime() / 1000) - 7200));
    expect(await expired.json()).toEqual({ error: 'sessao_expirada' });
    const after = await pool.query('select count(*)::int as n from public.telegram_auth_replays');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('o registro anti-reuso fica no banco e a limpeza apaga o que já não importa', async () => {
    await linkedUser(base + 7);
    const data = sign(base + 7);
    await login(data);
    const hash = hashes[hashes.length - 1]!;
    const row = await pool.query('select seen_at from public.telegram_auth_replays where hash = $1', [hash]);
    expect(row.rowCount).toBe(1);

    // Passado mais de um dia, a limpeza do agendador remove o registro.
    now = new Date(now.getTime() + 25 * 3600_000);
    const purged = await pool.query('select public.purge_telegram_auth_replays($1) as n', [now.toISOString()]);
    expect(purged.rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await pool.query('select 1 from public.telegram_auth_replays where hash = $1', [hash])).rowCount).toBe(0);
    now = new Date('2026-11-04T15:00:00.000Z');
  });

  it('a tabela é fechada para clientes (RLS sem concessões)', async () => {
    const anon = createClient(env.url, env.anonKey, opts);
    const { error } = await anon.from('telegram_auth_replays').select('hash').limit(1);
    expect(error).not.toBeNull();
  });

  it('sem token do bot o login fica desligado (503)', async () => {
    const res = await login(sign(base + 8), appWithoutBot);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'login_desabilitado' });
  });
});
