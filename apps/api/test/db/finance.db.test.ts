import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictError } from '../../src/application/errors.js';
import { createSupabaseFinanceRepository } from '../../src/infra/supabase-finance-repository.js';
import { asAnon, asUser, closePool, createUser, deleteCreatedUsers, pool } from './helpers.js';
import { getSupabaseEnv } from './supabase-env.js';

const DENIED = { code: '42501' };
const env = getSupabaseEnv();
const admin = createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const repo = createSupabaseFinanceRepository(admin);

let A = '';
let B = '';
let aEntry = '';

const insertSql = `insert into public.finance_entries (user_id, kind, description, amount_cents, due_date, status, paid_at)
  values ($1, 'gasto', 'Segredo', 1000, '2026-11-04', 'paga', now()) returning id`;

beforeAll(async () => {
  A = await createUser();
  B = await createUser();
  aEntry = (await pool.query<{ id: string }>(insertSql, [A])).rows[0]!.id;
});

afterAll(async () => {
  await deleteCreatedUsers();
  await closePool();
});

describe('finance_entries: constraints', () => {
  const bad = (sql: string, params: unknown[]) => pool.query(sql, params);
  const base = `insert into public.finance_entries (user_id, kind, description, amount_cents, due_date, status, paid_at) values`;

  it('rejects zero, negative and oversized amounts', async () => {
    for (const cents of [0, -5, 100000000000]) {
      await expect(bad(`${base} ($1, 'gasto', 'x', $2, '2026-11-04', 'paga', now())`, [A, cents])).rejects.toMatchObject({
        code: '23514',
      });
    }
  });

  it('rejects unknown kind/status, empty description and a gasto that is not paid', async () => {
    await expect(bad(`${base} ($1, 'outro', 'x', 100, '2026-11-04', 'paga', now())`, [A])).rejects.toMatchObject({ code: '23514' });
    await expect(bad(`${base} ($1, 'conta', 'x', 100, '2026-11-04', 'atrasada', null)`, [A])).rejects.toMatchObject({ code: '23514' });
    await expect(bad(`${base} ($1, 'conta', '', 100, '2026-11-04', 'a_pagar', null)`, [A])).rejects.toMatchObject({ code: '23514' });
    await expect(bad(`${base} ($1, 'gasto', 'x', 100, '2026-11-04', 'a_pagar', null)`, [A])).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps paid_at in step with status', async () => {
    await expect(bad(`${base} ($1, 'conta', 'x', 100, '2026-11-04', 'paga', null)`, [A])).rejects.toMatchObject({ code: '23514' });
    await expect(bad(`${base} ($1, 'conta', 'x', 100, '2026-11-04', 'a_pagar', now())`, [A])).rejects.toMatchObject({ code: '23514' });
  });

  it('maintains updated_at on update', async () => {
    const id = (await pool.query<{ id: string }>(insertSql, [A])).rows[0]!.id;
    const before = (await pool.query(`select updated_at from public.finance_entries where id = $1`, [id])).rows[0]!.updated_at;
    await pool.query(`select pg_sleep(0.01)`);
    await pool.query(`update public.finance_entries set description = 'novo' where id = $1`, [id]);
    const after = (await pool.query(`select updated_at from public.finance_entries where id = $1`, [id])).rows[0]!.updated_at;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});

describe('finance_entries: rls', () => {
  it('anon sees and writes nothing', async () => {
    await expect(asAnon((q) => q(`select id from public.finance_entries`))).rejects.toMatchObject(DENIED);
    await expect(asAnon((q) => q(insertSql, [A]))).rejects.toMatchObject(DENIED);
  });

  it('the owner reads its own rows but cannot write them: writes go through the API', async () => {
    await asUser(A, async (q) => {
      expect((await q(`select id from public.finance_entries where id = $1`, [aEntry])).rowCount).toBe(1);
    });
    await expect(
      asUser(A, (q) => q(`update public.finance_entries set description = 'meu' where id = $1`, [aEntry])),
    ).rejects.toMatchObject(DENIED);
    await expect(asUser(A, (q) => q(insertSql, [A]))).rejects.toMatchObject(DENIED);
    await expect(
      asUser(A, (q) => q(`delete from public.finance_entries where id = $1`, [aEntry])),
    ).rejects.toMatchObject(DENIED);
  });

  it('another user sees none of them and cannot update or delete them', async () => {
    await asUser(B, async (q) => {
      expect((await q(`select 1 from public.finance_entries where id = $1`, [aEntry])).rowCount).toBe(0);
      expect((await q(`select 1 from public.finance_entries where user_id = $1`, [A])).rowCount).toBe(0);
    });
    await expect(
      asUser(B, (q) => q(`update public.finance_entries set description = 'hack' where id = $1`, [aEntry])),
    ).rejects.toMatchObject(DENIED);
    await expect(
      asUser(B, (q) => q(`delete from public.finance_entries where id = $1`, [aEntry])),
    ).rejects.toMatchObject(DENIED);
    const row = await pool.query(`select description from public.finance_entries where id = $1`, [aEntry]);
    expect(row.rows).toEqual([{ description: 'Segredo' }]);
  });

  it('another user cannot insert for, or hand over a row to, someone else', async () => {
    await expect(asUser(B, (q) => q(insertSql, [A]))).rejects.toMatchObject(DENIED);
    await expect(
      asUser(A, (q) => q(`update public.finance_entries set user_id = $1 where id = $2`, [B, aEntry])),
    ).rejects.toMatchObject(DENIED);
  });

  it('authenticated has only select on the table', async () => {
    const { rows } = await pool.query<{ priv: string; ok: boolean }>(
      `select p.priv, has_table_privilege('authenticated', 'public.finance_entries', p.priv) as ok
         from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(priv)`,
    );
    expect(rows.filter((r) => r.ok).map((r) => r.priv).sort()).toEqual(['SELECT']);
    const anon = await pool.query(`select has_table_privilege('anon', 'public.finance_entries', 'SELECT') as ok`);
    expect(anon.rows[0].ok).toBe(false);
  });
});

describe('finance repository (service role, as the API runs)', () => {
  const entry = {
    kind: 'conta' as const,
    description: 'Aluguel',
    amountCents: 120000,
    category: 'Moradia',
    dueDate: '2026-11-05',
    status: 'a_pagar' as const,
    reminderTime: '09:00',
    paidAt: null,
  };

  it('creates, reads back with exact mapping, lists, updates and removes', async () => {
    const id = randomUUID();
    const created = await repo.create(A, { ...entry, id });
    expect(created).toEqual({
      ...entry,
      id,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(await repo.get(A, id)).toEqual(created);

    const paidAt = '2026-11-05T12:00:00.000Z';
    const paid = await repo.update(A, id, { status: 'paga', paidAt });
    expect(paid).toMatchObject({ status: 'paga', paidAt, reminderTime: '09:00', description: 'Aluguel' });
    const undone = await repo.update(A, id, { status: 'a_pagar', paidAt: null });
    expect(undone).toMatchObject({ status: 'a_pagar', paidAt: null });
    const edited = await repo.update(A, id, { category: null, amountCents: 99999999999 });
    expect(edited).toMatchObject({ category: null, amountCents: 99999999999 });

    expect(await repo.remove(A, id)).toBe(true);
    expect(await repo.get(A, id)).toBeNull();
    expect(await repo.remove(A, id)).toBe(false);
  });

  it('a repeated id is a ConflictError', async () => {
    const id = randomUUID();
    await repo.create(A, { ...entry, id });
    await expect(repo.create(A, { ...entry, id })).rejects.toBeInstanceOf(ConflictError);
  });

  it('lists with from/to/status filters, newest first, only for the user', async () => {
    const owner = await createUser();
    const other = await createUser();
    await repo.create(owner, { ...entry, description: 'a', dueDate: '2026-10-30', status: 'paga', paidAt: '2026-10-30T10:00:00.000Z' });
    await repo.create(owner, { ...entry, description: 'b', dueDate: '2026-11-05' });
    await repo.create(owner, { ...entry, description: 'c', dueDate: '2026-11-20' });
    await repo.create(other, { ...entry, description: 'de outro' });

    const all = await repo.list(owner, {});
    expect(all.map((e) => e.description)).toEqual(['c', 'b', 'a']);
    expect((await repo.list(owner, { from: '2026-11-01', to: '2026-11-30' })).map((e) => e.description)).toEqual(['c', 'b']);
    expect((await repo.list(owner, { status: 'paga' })).map((e) => e.description)).toEqual(['a']);
  });

  it('never reads, changes or deletes another user\'s entry, and treats malformed ids as missing', async () => {
    const id = randomUUID();
    await repo.create(A, { ...entry, id });
    expect(await repo.get(B, id)).toBeNull();
    expect(await repo.update(B, id, { description: 'hack' })).toBeNull();
    expect(await repo.remove(B, id)).toBe(false);
    expect((await repo.get(A, id))?.description).toBe('Aluguel');
    expect(await repo.get(A, 'abc')).toBeNull();
    expect(await repo.update(A, 'abc', { description: 'x' })).toBeNull();
    expect(await repo.remove(A, 'abc')).toBe(false);
  });
});
