import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ForeignEventError } from '../../src/application/errors.js';
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

describe('InboundEventRepository.register', () => {
  it('lets exactly one of two simultaneous registers be the first', async () => {
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
    await events.beginModelCall('painel', id, T0);
    await events.markFailed('painel', id, T0);
    const again = await events.register(A, 'painel', id, minutes(1));
    expect(again).toEqual({ firstTime: true, status: 'recebido', reply: null });
    const { rows } = await pool.query(
      `select status, processed_at, attempt_count from public.inbound_events where external_id = $1`,
      [id],
    );
    expect(rows[0].status).toBe('recebido');
    expect(rows[0].processed_at).toBeNull();
    expect(rows[0].attempt_count).toBe(1);
  });

  it('returns firstTime false with the stored reply after processing (jsonb roundtrip)', async () => {
    const id = extId();
    const reply = { message: 'Pronto', created: [{ id: 'x', nested: { n: 1, list: [1, 'a', null] } }] };
    await events.register(A, 'painel', id, T0);
    await events.beginModelCall('painel', id, T0);
    await events.markProcessed('painel', id, reply, T0);
    const again = await events.register(A, 'painel', id, minutes(1));
    expect(again).toEqual({ firstTime: false, status: 'processado', reply });
    const { rows } = await pool.query(
      `select processed_at from public.inbound_events where external_id = $1`,
      [id],
    );
    expect(rows[0].processed_at).not.toBeNull();
  });

  it('reports processando as not first time', async () => {
    const id = extId();
    await events.register(A, 'painel', id, T0);
    await events.beginModelCall('painel', id, T0);
    const again = await events.register(A, 'painel', id, T0);
    expect(again).toEqual({ firstTime: false, status: 'processando', reply: null });
  });

  it('rejects the same externalId from another user and leaks no reply', async () => {
    const id = extId();
    await events.register(A, 'painel', id, T0);
    await events.markProcessed('painel', id, { secret: 'resposta da A' }, T0);
    await expect(events.register(B, 'painel', id, T0)).rejects.toBeInstanceOf(ForeignEventError);
    const { rows } = await pool.query(
      `select user_id, status from public.inbound_events where external_id = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(A);
  });

  it('rejects a failed event of another user without resetting it', async () => {
    const id = extId();
    await events.register(A, 'painel', id, T0);
    await events.markFailed('painel', id, T0);
    await expect(events.register(B, 'painel', id, T0)).rejects.toBeInstanceOf(ForeignEventError);
    const { rows } = await pool.query(`select status from public.inbound_events where external_id = $1`, [id]);
    expect(rows[0].status).toBe('falhou');
  });

  it('adopts a null-user event for the first user that registers it', async () => {
    const id = extId();
    const first = await events.register(null, 'telegram', id, T0);
    expect(first.firstTime).toBe(true);
    const adopted = await events.register(A, 'telegram', id, T0);
    expect(adopted.firstTime).toBe(false);
    const { rows } = await pool.query(`select user_id from public.inbound_events where external_id = $1`, [id]);
    expect(rows[0].user_id).toBe(A);
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
    await expect(
      events.markProcessed('painel', id, { text: 'x'.repeat(70_000) }, T0),
    ).rejects.toThrow();
    const { rows } = await pool.query(
      `select status, reply from public.inbound_events where external_id = $1`,
      [id],
    );
    expect(rows[0].status).toBe('recebido');
    expect(rows[0].reply).toBeNull();
  });

  it('propagates a database failure instead of swallowing it', async () => {
    const broken = createSupabaseInboundEventRepository(brokenClient());
    await expect(broken.register(A, 'painel', extId(), T0)).rejects.toThrow();
  });
});

describe('InboundEventRepository.countSince', () => {
  it('counts only events of that user and channel with attempt_count >= 1 since the cutoff', async () => {
    const U = await createUser();
    const V = await createUser();
    const since = minutes(0);
    const mk = async (user: string, channel: 'painel' | 'telegram', at: Date, calls: number) => {
      const id = extId();
      await events.register(user, channel, id, at);
      for (let i = 0; i < calls; i++) await events.beginModelCall(channel, id, at);
    };
    await mk(U, 'painel', minutes(1), 1); // counts
    await mk(U, 'painel', minutes(2), 2); // counts (one event)
    await mk(U, 'painel', minutes(3), 0); // refused: attempt_count 0
    await mk(U, 'painel', minutes(-5), 1); // before cutoff
    await mk(U, 'telegram', minutes(1), 1); // other channel
    await mk(V, 'painel', minutes(1), 1); // other user
    expect(await events.countSince(U, 'painel', since)).toBe(2);
    expect(await events.countSince(U, 'telegram', since)).toBe(1);
    expect(await events.countSince(V, 'painel', since)).toBe(1);
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
