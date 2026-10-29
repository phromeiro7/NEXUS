import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventStateError, ForeignEventError } from '../../src/application/errors.js';
import { createSupabaseChatRepository } from '../../src/infra/supabase-chat-repository.js';
import { createSupabaseInboundEventRepository } from '../../src/infra/supabase-inbound-event-repository.js';
import { closePool, createUser, deleteCreatedUsers, pool } from './helpers.js';
import { getSupabaseEnv } from './supabase-env.js';

const env = getSupabaseEnv();
const admin: SupabaseClient = createClient(env.url, env.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
/** A client the API rejects (invalid key): every call fails fast with a database error. */
const brokenClient = () =>
  createClient(env.url, 'not-a-valid-key', { auth: { persistSession: false, autoRefreshToken: false } });
const chat = createSupabaseChatRepository(admin);
const events = createSupabaseInboundEventRepository(admin);

const T0 = new Date('2026-10-27T12:00:00Z');
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const extId = () => `ext-${randomUUID()}`;

let A = '';
let B = '';

beforeAll(async () => {
  A = await createUser();
  B = await createUser();
});

afterAll(async () => {
  await deleteCreatedUsers();
  await closePool();
});

async function row(id: string) {
  const { rows } = await pool.query(
    `select user_id, status, processed_at, attempt_count, reply, received_at
       from public.inbound_events where external_id = $1`,
    [id],
  );
  return rows[0];
}

describe('InboundEventRepository.register', () => {
  it('lets exactly one of simultaneous registers be the first', async () => {
    const id = extId();
    const results = await Promise.all([
      events.register(A, 'painel', id, T0),
      events.register(A, 'painel', id, T0),
      events.register(A, 'painel', id, T0),
    ]);
    expect(results.filter((r) => r.firstTime)).toHaveLength(1);
    expect(results.filter((r) => !r.firstTime)).toHaveLength(2);
    expect(results.every((r) => r.status === 'recebido' && r.reply === null)).toBe(true);
  });

  it('reprocesses a failed event: firstTime again and status recebido', async () => {
    const id = extId();
    expect((await events.register(A, 'painel', id, T0)).firstTime).toBe(true);
    await events.beginModelCall(A, 'painel', id, T0);
    await events.markFailed(A, 'painel', id, T0);
    const again = await events.register(A, 'painel', id, minutes(1));
    expect(again).toEqual({ firstTime: true, status: 'recebido', reply: null });
    const r = await row(id);
    expect(r.status).toBe('recebido');
    expect(r.processed_at).toBeNull();
    expect(r.attempt_count).toBe(1);
  });

  it('returns firstTime false with the stored reply after processing (jsonb roundtrip)', async () => {
    const id = extId();
    const reply = { message: 'Pronto', created: [{ id: 'x', nested: { n: 1, list: [1, 'a', null] } }] };
    await events.register(A, 'painel', id, T0);
    await events.beginModelCall(A, 'painel', id, T0);
    await events.markProcessed(A, 'painel', id, reply, T0);
    const again = await events.register(A, 'painel', id, minutes(1));
    expect(again).toEqual({ firstTime: false, status: 'processado', reply });
    expect((await row(id)).processed_at).not.toBeNull();
  });

  it('reports processando as not first time', async () => {
    const id = extId();
    await events.register(A, 'painel', id, T0);
    await events.beginModelCall(A, 'painel', id, T0);
    const again = await events.register(A, 'painel', id, T0);
    expect(again).toEqual({ firstTime: false, status: 'processando', reply: null });
  });

  it('rejects the same externalId from another user and leaks no reply', async () => {
    const id = extId();
    await events.register(A, 'painel', id, T0);
    await events.beginModelCall(A, 'painel', id, T0);
    await events.markProcessed(A, 'painel', id, { secret: 'resposta da A' }, T0);
    await expect(events.register(B, 'painel', id, T0)).rejects.toBeInstanceOf(ForeignEventError);
    expect((await row(id)).user_id).toBe(A);
  });

  it('rejects a failed event of another user without resetting it', async () => {
    const id = extId();
    await events.register(A, 'painel', id, T0);
    await events.markFailed(A, 'painel', id, T0);
    await expect(events.register(B, 'painel', id, T0)).rejects.toBeInstanceOf(ForeignEventError);
    expect((await row(id)).status).toBe('falhou');
  });

  it('adopts a null-user event for the first user that registers it', async () => {
    const id = extId();
    const first = await events.register(null, 'telegram', id, T0);
    expect(first.firstTime).toBe(true);
    const adopted = await events.register(A, 'telegram', id, T0);
    expect(adopted.firstTime).toBe(false);
    expect((await row(id)).user_id).toBe(A);
    await expect(events.register(B, 'telegram', id, T0)).rejects.toBeInstanceOf(ForeignEventError);
  });

  it('keeps channels independent for the same externalId', async () => {
    const id = extId();
    expect((await events.register(A, 'painel', id, T0)).firstTime).toBe(true);
    expect((await events.register(A, 'telegram', id, T0)).firstTime).toBe(true);
  });

  it('rejects an oversized reply with the size check', async () => {
    const id = extId();
    await events.register(A, 'painel', id, T0);
    await events.beginModelCall(A, 'painel', id, T0);
    await expect(
      events.markProcessed(A, 'painel', id, { text: 'x'.repeat(70_000) }, T0),
    ).rejects.toThrow();
    const r = await row(id);
    expect(r.status).toBe('processando');
    expect(r.reply).toBeNull();
  });

  it('propagates a database failure instead of swallowing it', async () => {
    const broken = createSupabaseInboundEventRepository(brokenClient());
    await expect(broken.register(A, 'painel', extId(), T0)).rejects.toThrow();
    await expect(broken.beginModelCall(A, 'painel', extId(), T0)).rejects.toThrow();
  });
});

describe('InboundEventRepository state transitions are scoped by user and status', () => {
  it('another user cannot begin, process or fail A event, and no forged reply is returned', async () => {
    const id = extId();
    await events.register(A, 'painel', id, T0);
    await events.beginModelCall(A, 'painel', id, T0);
    await expect(events.markProcessed(B, 'painel', id, { forged: true }, T0)).rejects.toBeInstanceOf(ForeignEventError);
    await expect(events.markFailed(B, 'painel', id, T0)).rejects.toBeInstanceOf(ForeignEventError);
    await expect(events.markProcessed(null, 'painel', id, { forged: true }, T0)).rejects.toBeInstanceOf(ForeignEventError);
    let r = await row(id);
    expect(r.status).toBe('processando');
    expect(r.reply).toBeNull();

    const id2 = extId();
    await events.register(A, 'painel', id2, T0);
    await expect(events.beginModelCall(B, 'painel', id2, T0)).rejects.toBeInstanceOf(ForeignEventError);
    r = await row(id2);
    expect(r).toMatchObject({ status: 'recebido', attempt_count: 0 });
    expect(await events.register(A, 'painel', id2, T0)).toEqual({ firstTime: false, status: 'recebido', reply: null });
  });

  it('null-user events are updated only with a null user', async () => {
    const id = extId();
    await events.register(null, 'telegram', id, T0);
    await expect(events.markFailed(A, 'telegram', id, T0)).rejects.toBeInstanceOf(ForeignEventError);
    await events.markFailed(null, 'telegram', id, T0);
    expect((await row(id)).status).toBe('falhou');
  });

  it('a processed event can never be changed by markFailed, markProcessed or beginModelCall', async () => {
    const id = extId();
    await events.register(A, 'painel', id, T0);
    await events.beginModelCall(A, 'painel', id, T0);
    await events.markProcessed(A, 'painel', id, { ok: 1 }, T0);
    await expect(events.markFailed(A, 'painel', id, T0)).rejects.toBeInstanceOf(EventStateError);
    await expect(events.markProcessed(A, 'painel', id, { ok: 2 }, T0)).rejects.toBeInstanceOf(EventStateError);
    await expect(events.beginModelCall(A, 'painel', id, T0)).rejects.toBeInstanceOf(EventStateError);
    const r = await row(id);
    expect(r.status).toBe('processado');
    expect(r.reply).toEqual({ ok: 1 });
    expect(r.attempt_count).toBe(1);
  });

  it('markProcessed requires processando (not recebido, not falhou)', async () => {
    const id = extId();
    await events.register(A, 'painel', id, T0);
    await expect(events.markProcessed(A, 'painel', id, { x: 1 }, T0)).rejects.toBeInstanceOf(EventStateError);
    await events.markFailed(A, 'painel', id, T0); // refused before the model: allowed from recebido
    await expect(events.markProcessed(A, 'painel', id, { x: 1 }, T0)).rejects.toBeInstanceOf(EventStateError);
    expect((await row(id)).status).toBe('falhou');
  });

  it('markFailed is not allowed from falhou, and a missing event raises', async () => {
    const id = extId();
    await events.register(A, 'painel', id, T0);
    await events.markFailed(A, 'painel', id, T0);
    await expect(events.markFailed(A, 'painel', id, T0)).rejects.toBeInstanceOf(EventStateError);
    await expect(events.markFailed(A, 'painel', extId(), T0)).rejects.toBeInstanceOf(EventStateError);
    await expect(events.beginModelCall(A, 'painel', extId(), T0)).rejects.toBeInstanceOf(EventStateError);
  });

  it('beginModelCall only runs from recebido and rejects a null user', async () => {
    const id = extId();
    await events.register(A, 'painel', id, T0);
    await events.beginModelCall(A, 'painel', id, T0);
    await expect(events.beginModelCall(A, 'painel', id, T0)).rejects.toBeInstanceOf(EventStateError); // processando
    await expect(events.beginModelCall(null as unknown as string, 'painel', id, T0)).rejects.toBeInstanceOf(EventStateError);
    expect((await row(id)).attempt_count).toBe(1);
  });

  it('simultaneous beginModelCall: exactly one succeeds from recebido, others get the state error', async () => {
    const id = extId();
    await events.register(A, 'painel', id, T0);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => events.beginModelCall(A, 'painel', id, T0)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(5);
    expect(rejected.every((r) => r.reason instanceof EventStateError)).toBe(true);
    expect((await row(id)).attempt_count).toBe(1);
    expect(await events.countSince(A, 'painel', minutes(-1))).toBeGreaterThanOrEqual(1);
  });

  it('begin_model_call and register_inbound_event are not executable by anon or authenticated', async () => {
    const { rows } = await pool.query(
      `select p.proname, r.role, has_function_privilege(r.role, p.oid, 'EXECUTE') as can
         from pg_proc p cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role)
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('begin_model_call', 'register_inbound_event')`,
    );
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(r.can).toBe(r.role === 'service_role');
  });

  it('assistant_model_calls has RLS and no client grants', async () => {
    const { rows } = await pool.query(
      `select c.relrowsecurity,
              has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as anon_any,
              has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
              has_table_privilege('authenticated', c.oid, 'INSERT') as auth_insert
         from pg_class c where c.oid = 'public.assistant_model_calls'::regclass`,
    );
    expect(rows[0]).toEqual({ relrowsecurity: true, anon_any: false, auth_select: false, auth_insert: false });
  });
});

describe('InboundEventRepository.countSince counts model calls', () => {
  it('counts calls of that user and channel since the cutoff (>=), each call once', async () => {
    const U = await createUser();
    const V = await createUser();
    const since = minutes(0);
    const call = async (user: string, channel: 'painel' | 'telegram', at: Date) => {
      const id = extId();
      await events.register(user, channel, id, at);
      await events.beginModelCall(user, channel, id, at);
    };
    await call(U, 'painel', minutes(0)); // boundary: counts
    await call(U, 'painel', minutes(2)); // counts
    await call(U, 'painel', minutes(-1)); // before the cutoff
    await call(U, 'telegram', minutes(1)); // other channel
    await call(V, 'painel', minutes(1)); // other user
    const refused = extId();
    await events.register(U, 'painel', refused, minutes(3));
    await events.markFailed(U, 'painel', refused, minutes(3)); // refused: never called the model
    expect(await events.countSince(U, 'painel', since)).toBe(2);
    expect(await events.countSince(U, 'telegram', since)).toBe(1);
    expect(await events.countSince(V, 'painel', since)).toBe(1);
  });

  it('a resent failed event does not count before begin_model_call, and a refused resend never counts', async () => {
    const U = await createUser();
    const id = extId();
    await events.register(U, 'painel', id, minutes(0));
    await events.beginModelCall(U, 'painel', id, minutes(0));
    await events.markFailed(U, 'painel', id, minutes(1));
    expect(await events.countSince(U, 'painel', minutes(-1))).toBe(1);
    // A later window: the resend resets received_at but must not count.
    expect(await events.register(U, 'painel', id, minutes(120))).toMatchObject({ firstTime: true });
    expect(await events.countSince(U, 'painel', minutes(60))).toBe(0);
    await events.markFailed(U, 'painel', id, minutes(121)); // refused again
    await events.register(U, 'painel', id, minutes(180));
    expect(await events.countSince(U, 'painel', minutes(150))).toBe(0);
  });

  it('three model calls on the same event count as three', async () => {
    const U = await createUser();
    const id = extId();
    await events.register(U, 'painel', id, minutes(0));
    for (let i = 0; i < 3; i++) {
      await events.beginModelCall(U, 'painel', id, minutes(i));
      await events.markFailed(U, 'painel', id, minutes(i));
      await events.register(U, 'painel', id, minutes(i + 1));
    }
    expect(await events.countSince(U, 'painel', minutes(-1))).toBe(3);
    expect((await row(id)).attempt_count).toBe(3);
  });
});

describe('ChatRepository', () => {
  it('returns chronological order, respects the limit and ignores expired messages', async () => {
    const U = await createUser();
    await chat.append(U, 'painel', 'user', 'velha', minutes(-60 * 25)); // expires before T0
    await chat.append(U, 'painel', 'user', 'um', minutes(1));
    await chat.append(U, 'painel', 'assistant', 'dois', minutes(2));
    await chat.append(U, 'painel', 'user', 'tres', minutes(3));
    expect(await chat.recent(U, 'painel', 10, minutes(5))).toEqual([
      { role: 'user', content: 'um' },
      { role: 'assistant', content: 'dois' },
      { role: 'user', content: 'tres' },
    ]);
    expect(await chat.recent(U, 'painel', 2, minutes(5))).toEqual([
      { role: 'assistant', content: 'dois' },
      { role: 'user', content: 'tres' },
    ]);
    // a message expires 24h after it was appended
    expect(await chat.recent(U, 'painel', 10, minutes(60 * 24 + 1))).toEqual([
      { role: 'assistant', content: 'dois' },
      { role: 'user', content: 'tres' },
    ]);
  });

  it('keeps channels separate', async () => {
    const U = await createUser();
    await chat.append(U, 'painel', 'user', 'painel', T0);
    await chat.append(U, 'telegram', 'user', 'telegram', T0);
    expect(await chat.recent(U, 'telegram', 10, T0)).toEqual([{ role: 'user', content: 'telegram' }]);
  });

  it('never shows user A messages to user B', async () => {
    await chat.append(A, 'painel', 'user', 'segredo da A', T0);
    const seenByB = await chat.recent(B, 'painel', 100, T0);
    expect(seenByB.some((m) => m.content === 'segredo da A')).toBe(false);
  });

  it('keeps append order when two messages share the same timestamp', async () => {
    const U = await createUser();
    await chat.append(U, 'painel', 'user', 'pergunta', T0);
    await chat.append(U, 'painel', 'assistant', 'resposta', T0);
    expect(await chat.recent(U, 'painel', 10, T0)).toEqual([
      { role: 'user', content: 'pergunta' },
      { role: 'assistant', content: 'resposta' },
    ]);
  });

  it('propagates a database failure', async () => {
    const broken = createSupabaseChatRepository(brokenClient());
    await expect(broken.recent(A, 'painel', 5, T0)).rejects.toThrow();
    await expect(broken.append(A, 'painel', 'user', 'x', T0)).rejects.toThrow();
  });
});
