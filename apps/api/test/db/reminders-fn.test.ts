import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  asAnon,
  asServiceRole,
  asUser,
  closePool,
  createUser,
  deleteCreatedUsers,
  type Query,
} from './helpers';

afterAll(async () => {
  await deleteCreatedUsers();
  await closePool();
});

const REPLACE = `select public.replace_pending_reminders($1::uuid, $2::uuid, $3::jsonb)`;

async function insertTask(q: Query, userId: string): Promise<string> {
  const id = randomUUID();
  await q(`insert into public.tasks (id, user_id, title) values ($1, $2, 'tarefa de teste')`, [
    id,
    userId,
  ]);
  return id;
}

async function insertReminder(
  q: Query,
  userId: string,
  taskId: string,
  kind: string,
  status: string,
  at = '2030-01-01T10:00:00Z',
): Promise<void> {
  await q(
    `insert into public.reminders (user_id, task_id, kind, scheduled_at, status)
     values ($1, $2, $3, $4, $5)`,
    [userId, taskId, kind, at, status],
  );
}

async function list(q: Query, taskId: string) {
  const { rows } = await q(
    `select kind, status, scheduled_at::text as scheduled_at
       from public.reminders where task_id = $1 order by kind, status`,
    [taskId],
  );
  return rows as { kind: string; status: string; scheduled_at: string }[];
}

const drafts = (...items: [string, string][]) =>
  JSON.stringify(items.map(([kind, scheduled_at]) => ({ kind, scheduled_at })));

describe('public.replace_pending_reminders', () => {
  it('(a) leaves exactly the two drafts as pendente', async () => {
    const a = await createUser();
    await asServiceRole(async (q) => {
      const task = await insertTask(q, a);
      await q(
        REPLACE,
        [a, task, drafts(['tres_dias', '2030-02-01T10:00:00Z'], ['no_dia', '2030-02-04T10:00:00Z'])],
      );
      const rows = await list(q, task);
      expect(rows.map((r) => [r.kind, r.status])).toEqual([
        ['no_dia', 'pendente'],
        ['tres_dias', 'pendente'],
      ]);
    });
  });

  it('(b) a second call replaces the previous pending reminders', async () => {
    const a = await createUser();
    await asServiceRole(async (q) => {
      const task = await insertTask(q, a);
      await q(
        REPLACE,
        [a, task, drafts(['tres_dias', '2030-02-01T10:00:00Z'], ['no_dia', '2030-02-04T10:00:00Z'])],
      );
      await q(
        REPLACE,
        [a, task, drafts(['dia_anterior', '2030-03-01T10:00:00Z'], ['no_dia', '2030-03-02T10:00:00Z'])],
      );
      const { rows } = await q(
        `select kind, extract(epoch from scheduled_at)::bigint::text as ts
           from public.reminders where task_id = $1 and status = 'pendente' order by kind`,
        [task],
      );
      expect(rows).toEqual([
        { kind: 'dia_anterior', ts: String(Date.parse('2030-03-01T10:00:00Z') / 1000) },
        { kind: 'no_dia', ts: String(Date.parse('2030-03-02T10:00:00Z') / 1000) },
      ]);
    });
  });

  it('(c) never deletes enviado or enviando reminders, nor duplicates an enviando kind', async () => {
    const a = await createUser();
    await asServiceRole(async (q) => {
      const task = await insertTask(q, a);
      await insertReminder(q, a, task, 'tres_dias', 'enviado');
      await insertReminder(q, a, task, 'no_dia', 'enviando');
      await insertReminder(q, a, task, 'antecipado', 'pendente');
      await q(
        REPLACE,
        [a, task, drafts(['no_dia', '2031-01-01T10:00:00Z'], ['dia_anterior', '2031-01-02T10:00:00Z'])],
      );
      const rows = await list(q, task);
      expect(rows.map((r) => [r.kind, r.status])).toEqual([
        ['dia_anterior', 'pendente'],
        ['no_dia', 'enviando'],
        ['tres_dias', 'enviado'],
      ]);
      // The in-flight reminder was not overwritten.
      const inflight = rows.find((r) => r.kind === 'no_dia');
      expect(inflight?.scheduled_at).toContain('2030-01-01');
    });
  });

  it('(d) an empty list only removes the pendente reminders', async () => {
    const a = await createUser();
    await asServiceRole(async (q) => {
      const task = await insertTask(q, a);
      await insertReminder(q, a, task, 'tres_dias', 'enviado');
      await insertReminder(q, a, task, 'no_dia', 'enviando');
      await insertReminder(q, a, task, 'antecipado', 'pendente');
      await q(REPLACE, [a, task, '[]']);
      const rows = await list(q, task);
      expect(rows.map((r) => [r.kind, r.status])).toEqual([
        ['no_dia', 'enviando'],
        ['tres_dias', 'enviado'],
      ]);
    });
  });

  it("(e) another user's id with this task fails with 23503 and changes nothing", async () => {
    const a = await createUser();
    const b = await createUser();
    await asServiceRole(async (q) => {
      const task = await insertTask(q, a);
      await insertReminder(q, a, task, 'antecipado', 'pendente');
      await insertReminder(q, a, task, 'tres_dias', 'enviado');
      const before = await list(q, task);
      await q('savepoint wrong_pair');
      await expect(
        q(REPLACE, [b, task, drafts(['no_dia', '2030-02-04T10:00:00Z'])]),
      ).rejects.toMatchObject({ code: '23503' });
      await q('rollback to savepoint wrong_pair');
      expect(await list(q, task)).toEqual(before);
    });
  });

  it('(f) an invalid kind fails with 23514', async () => {
    const a = await createUser();
    await asServiceRole(async (q) => {
      const task = await insertTask(q, a);
      await expect(
        q(REPLACE, [a, task, drafts(['invalido', '2030-02-04T10:00:00Z'])]),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it('(g) anon and authenticated cannot execute it (42501)', async () => {
    const a = await createUser();
    const args = [a, randomUUID(), '[]'];
    await expect(asAnon((q) => q(REPLACE, args))).rejects.toMatchObject({ code: '42501' });
    await expect(asUser(a, (q) => q(REPLACE, args))).rejects.toMatchObject({ code: '42501' });
  });

  it('(h) works end to end as service_role', async () => {
    const a = await createUser();
    const count = await asServiceRole(async (q) => {
      const task = await insertTask(q, a);
      await q(REPLACE, [a, task, drafts(['no_horario', '2030-05-01T10:00:00Z'])]);
      const { rows } = await q(
        `select count(*)::int as n from public.reminders where task_id = $1 and status = 'pendente'`,
        [task],
      );
      return rows[0].n as number;
    });
    expect(count).toBe(1);
  });
});
