import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/compose.js';
import { createSupabaseCaptureRepository } from '../../src/infra/supabase-capture-repository.js';
import { createFakes } from '../fakes.js';
import { closePool, createUser, deleteCreatedUsers, pool } from './helpers.js';
import { getSupabaseEnv } from './supabase-env.js';

const env = getSupabaseEnv();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin: SupabaseClient = createClient(env.url, env.serviceRoleKey, opts);
const captures = createSupabaseCaptureRepository(admin);

// Quarta-feira 2033-03-09, 09:00 em São Paulo (sem horário de verão em 2033).
let nowMs = Date.parse('2033-03-09T12:00:00.000Z');
const clock = { now: () => new Date(nowMs) };
const T0 = new Date(nowMs);
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

let A = '';
let B = '';
beforeAll(async () => {
  A = await createUser();
  B = await createUser();
});
afterAll(async () => {
  for (const id of authUserIds) await admin.auth.admin.deleteUser(id);
  await deleteCreatedUsers();
  await closePool();
}, 60_000);

const authUserIds: string[] = [];

describe('CaptureRepository (real database)', () => {
  const payload = { kind: 'gasto', description: 'roupa', amountCents: 10_000 };

  it('creates a pending proposal valid for one hour and reads it back', async () => {
    const created = await captures.create(A, 123, payload, T0);
    expect(created).toMatchObject({ userId: A, chatId: 123, status: 'pendente', entity: null, messageId: null, payload });
    expect(created.expiresAt.toISOString()).toBe(minutes(60).toISOString());
    expect(await captures.get(created.id, T0)).toMatchObject({ id: created.id, payload });
    expect(await captures.get(created.id, minutes(61))).toBeNull(); // expirada
    expect(await captures.get('nao-e-uuid', T0)).toBeNull();
  });

  it('only one of simultaneous confirms wins, and the rest of the machine follows', async () => {
    const { id } = await captures.create(A, 124, payload, T0);
    const wins = await Promise.all([captures.beginConfirm(id, T0), captures.beginConfirm(id, T0), captures.beginConfirm(id, T0)]);
    expect(wins.filter(Boolean)).toHaveLength(1);
    expect(await captures.updatePayload(id, { ...payload, category: 'X' })).toBe(false); // já não está pendente
    const entityId = randomUUID();
    await captures.finishConfirm(id, { kind: 'lancamento', id: entityId }, minutes(1));
    const confirmed = await captures.get(id, minutes(2));
    expect(confirmed).toMatchObject({ status: 'confirmada', entity: { kind: 'lancamento', id: entityId } });
    expect(confirmed!.expiresAt.toISOString()).toBe(minutes(1 + 24 * 60).toISOString());

    const undos = await Promise.all([captures.beginUndo(id, minutes(2)), captures.beginUndo(id, minutes(2))]);
    expect(undos.filter((u) => u !== null)).toEqual([{ kind: 'lancamento', id: entityId }]);
    expect((await captures.get(id, minutes(3)))!.status).toBe('desfeita');
    await captures.abortUndo(id);
    expect((await captures.get(id, minutes(3)))!.status).toBe('confirmada');
  });

  it('abortConfirm puts a claimed proposal back to pendente; an expired one cannot be confirmed', async () => {
    const first = await captures.create(A, 125, payload, T0);
    expect(await captures.beginConfirm(first.id, T0)).toBe(true);
    await captures.abortConfirm(first.id);
    expect((await captures.get(first.id, T0))!.status).toBe('pendente');
    expect(await captures.updatePayload(first.id, { ...payload, category: 'Y' })).toBe(true);
    expect(await captures.beginConfirm(first.id, minutes(61))).toBe(false);
    expect((await pool.query('select status from public.chat_captures where id = $1', [first.id])).rows[0].status).toBe('pendente');
  });

  it('stores the message id and purges only expired rows', async () => {
    const keep = await captures.create(B, 126, payload, T0);
    const gone = await captures.create(B, 127, payload, minutes(-120));
    await captures.setMessage(keep.id, 4242);
    expect((await captures.get(keep.id, T0))!.messageId).toBe(4242);
    expect(await captures.purgeExpired(T0)).toBeGreaterThanOrEqual(1);
    const left = await pool.query('select id from public.chat_captures where id = any($1::uuid[])', [[keep.id, gone.id]]);
    expect(left.rows.map((r) => r.id)).toEqual([keep.id]);
  });

  it('is closed to clients: no grants for anon or authenticated, RLS on', async () => {
    const { rows } = await pool.query(
      `select c.relrowsecurity as rls,
              has_table_privilege('anon', 'public.chat_captures', 'select') as anon_select,
              has_table_privilege('authenticated', 'public.chat_captures', 'select') as auth_select,
              has_table_privilege('authenticated', 'public.chat_captures', 'insert') as auth_insert
         from pg_class c where c.oid = 'public.chat_captures'::regclass`,
    );
    expect(rows[0]).toEqual({ rls: true, anon_select: false, auth_select: false, auth_insert: false });
  });

  it('rejects a payload that is too large and an unknown status', async () => {
    await expect(captures.create(A, 128, { big: 'x'.repeat(5000) }, T0)).rejects.toThrow();
    await expect(
      pool.query(`insert into public.chat_captures (user_id, chat_id, payload, status, expires_at) values ($1, 1, '{}', 'x', now())`, [A]),
    ).rejects.toThrow(/chat_captures_status_check/);
  });

  it('cascades when the user is deleted', async () => {
    const id = await createUser();
    const c = await captures.create(id, 129, payload, T0);
    await pool.query('delete from auth.users where id = $1', [id]);
    expect((await pool.query('select 1 from public.chat_captures where id = $1', [c.id])).rowCount).toBe(0);
  });
});

describe('journey: "gastei 100 em roupa" and "ligar pra vidinha hoje 14h" through the real API', () => {
  const WEBHOOK_SECRET = 'TEST_WEBHOOK_SECRET';
  const INTERNAL_SECRET = 'TEST_INTERNAL_SECRET';
  const fakes = createFakes();
  const telegram = fakes.telegram;
  const app = buildApp(
    {
      supabaseUrl: env.url,
      serviceRoleKey: env.serviceRoleKey,
      port: 0,
      webOrigin: 'http://localhost:3000',
      assistantModel: 'x',
      telegramBotUsername: 'meu_bot',
      telegramWebhookSecret: WEBHOOK_SECRET,
      internalSecret: INTERNAL_SECRET,
      miniAppUrl: 'https://nexus.example.test',
    },
    { clock, telegramClient: telegram },
  );

  let updateSeq = 7_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
  const hook = async (body: unknown) => {
    const res = await app.request('/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET },
      body: JSON.stringify(body),
    });
    return res.status;
  };
  const say = (chatId: number, text: string) =>
    hook({ update_id: updateSeq++, message: { message_id: 10, date: 1, chat: { id: chatId, type: 'private' }, text } });
  const press = (chatId: number, data: string, messageId: number) =>
    hook({ update_id: updateSeq++, callback_query: { id: `cb-${updateSeq}`, data, message: { message_id: messageId, chat: { id: chatId, type: 'private' } } } });
  const keyboardData = (label: string): string => {
    const sources = [telegram.edits.at(-1)?.keyboard, telegram.sent.at(-1)?.keyboard];
    for (const kb of sources) for (const b of kb?.flat() ?? []) if (b.text === label && 'callbackData' in b) return b.callbackData;
    throw new Error(`botão ${label} não encontrado`);
  };

  const chat = 8_800_000_000 + Math.floor(Math.random() * 1_000_000_000);
  let userId = '';

  beforeAll(async () => {
    const email = `cap-${randomUUID()}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: `pw-${randomUUID()}`, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    userId = data.user.id;
    authUserIds.push(userId);
    await pool.query(`update public.profiles set telegram_chat_id = $2, briefing_time = '23:00' where id = $1`, [userId, chat]);
  });

  it('an expense is only saved after Confirmar, shows in finance_entries, and Desfazer removes it', async () => {
    telegram.script({ ok: true, messageId: 901 });
    expect(await say(chat, 'gastei 100 em roupa')).toBe(200);
    expect(telegram.sent.at(-1)!.text).toBe('Anotei: R$ 100,00 em Roupas, hoje.');
    const before = await pool.query('select count(*)::int as n from public.finance_entries where user_id = $1', [userId]);
    expect(before.rows[0].n).toBe(0);

    expect(await press(chat, keyboardData('Confirmar'), 901)).toBe(200);
    const rows = (await pool.query(
      `select kind, description, amount_cents::int as amount_cents, category, due_date::text as due_date, status
         from public.finance_entries where user_id = $1`,
      [userId],
    )).rows;
    expect(rows).toEqual([{ kind: 'gasto', description: 'roupa', amount_cents: 10_000, category: 'Roupas', due_date: '2033-03-09', status: 'paga' }]);
    expect(telegram.edits.at(-1)!.text).toBe('Pronto, anotado. R$ 100,00 em Roupas, hoje.');

    expect(await press(chat, keyboardData('Desfazer'), 901)).toBe(200);
    expect((await pool.query('select count(*)::int as n from public.finance_entries where user_id = $1', [userId])).rows[0].n).toBe(0);
    expect(telegram.edits.at(-1)!.text).toContain('Desfeito.');
  });

  it('a task is created with its reminders only after Confirmar and the reminder goes out at the time', async () => {
    telegram.script({ ok: true, messageId: 902 });
    await say(chat, 'ligar pra vidinha hoje 14h');
    expect(telegram.sent.at(-1)!.text).toBe('Anotei: ligar pra vidinha, hoje às 14h.\nAviso: 15 min antes e na hora.');
    expect((await pool.query('select count(*)::int as n from public.tasks where user_id = $1', [userId])).rows[0].n).toBe(0);

    await press(chat, keyboardData('Confirmar'), 902);
    const tasks = (await pool.query(
      `select id, title, due_date::text as due_date, due_time::text as due_time, source from public.tasks where user_id = $1 and deleted_at is null`,
      [userId],
    )).rows;
    expect(tasks).toMatchObject([{ title: 'ligar pra vidinha', due_date: '2033-03-09', due_time: '14:00:00', source: 'telegram' }]);
    const reminders = (await pool.query(
      `select kind, to_char(scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at from public.reminders where task_id = $1 order by scheduled_at`,
      [tasks[0].id],
    )).rows;
    expect(reminders).toEqual([
      { kind: 'antecipado', at: '2033-03-09T16:45:00Z' },
      { kind: 'no_horario', at: '2033-03-09T17:00:00Z' },
    ]);

    // 13:46 local: o aviso antecipado sai pelo agendador, para o chat vinculado.
    nowMs = Date.parse('2033-03-09T16:46:00.000Z');
    const before = telegram.sent.length;
    const res = await app.request('/internal/reminders/run', { method: 'POST', headers: { 'X-Internal-Secret': INTERNAL_SECRET } });
    expect(res.status).toBe(200);
    expect(telegram.sent.slice(before).map((s) => s.text)).toEqual(['Tarefa às 14:00 (em breve): ligar pra vidinha']);
    expect(telegram.sent.at(-1)!.chatId).toBe(chat);
  });

  it('text the rules do not understand gets the short help (no assistant key configured)', async () => {
    await say(chat, 'bom dia, tudo certo por aí');
    expect(telegram.sent.at(-1)!.text).toContain('Não entendi.');
  });

  it('the scheduler purges expired proposals and reports it', async () => {
    nowMs = Date.parse('2033-03-12T12:00:00.000Z'); // 3 dias depois: tudo expirou
    const res = await app.request('/internal/reminders/run', { method: 'POST', headers: { 'X-Internal-Secret': INTERNAL_SECRET } });
    const body = (await res.json()) as { purged: { chatCaptures?: number } };
    expect(body.purged.chatCaptures).toBeGreaterThanOrEqual(1);
    expect((await pool.query('select count(*)::int as n from public.chat_captures where user_id = $1', [userId])).rows[0].n).toBe(0);
  });
});
