import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

const client = new pg.Client({ connectionString });

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

/** Runs fn inside a transaction that is always rolled back. */
async function inRollback(fn: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await fn();
  } finally {
    await client.query('rollback');
  }
}

async function insertUser(): Promise<string> {
  const id = randomUUID();
  await client.query(
    `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
    [id, `${id}@example.test`],
  );
  return id;
}

describe('schema', () => {
  it('has all the tables', async () => {
    const { rows } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = rows.map((r) => r.table_name);
    for (const t of [
      'profiles',
      'cases',
      'tasks',
      'reminders',
      'holidays',
      'inbound_events',
      'chat_messages',
      'link_codes',
      'task_confirmations',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('rejects duplicate (channel, external_id) in inbound_events', async () => {
    await inRollback(async () => {
      const ext = randomUUID();
      await client.query(
        `insert into public.inbound_events (channel, external_id) values ('telegram', $1)`,
        [ext],
      );
      await expect(
        client.query(
          `insert into public.inbound_events (channel, external_id) values ('telegram', $1)`,
          [ext],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('rejects a task with due_time but no due_date', async () => {
    await inRollback(async () => {
      const userId = await insertUser();
      await expect(
        client.query(
          `insert into public.tasks (user_id, title, due_time) values ($1, 'x', '10:00')`,
          [userId],
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'tasks_due_time_needs_date_check' });
    });
  });

  async function insertCase(userId: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `insert into public.cases (user_id, number) values ($1, $2) returning id`,
      [userId, randomUUID()],
    );
    return rows[0]!.id;
  }

  async function insertTask(userId: string, caseId: string | null = null): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `insert into public.tasks (user_id, case_id, title) values ($1, $2, 't') returning id`,
      [userId, caseId],
    );
    return rows[0]!.id;
  }

  async function insertReminder(userId: string, taskId: string): Promise<void> {
    await client.query(
      `insert into public.reminders (user_id, task_id, kind, scheduled_at) values ($1, $2, 'no_dia', now())`,
      [userId, taskId],
    );
  }

  it('rejects a task pointing at another user\'s case', async () => {
    await inRollback(async () => {
      const a = await insertUser();
      const b = await insertUser();
      const caseB = await insertCase(b);
      await expect(insertTask(a, caseB)).rejects.toMatchObject({ code: '23503' });
    });
  });

  it('rejects a reminder whose user differs from its task owner', async () => {
    await inRollback(async () => {
      const a = await insertUser();
      const b = await insertUser();
      const taskB = await insertTask(b);
      await expect(insertReminder(a, taskB)).rejects.toMatchObject({ code: '23503' });
    });
  });

  it('accepts same-owner links', async () => {
    await inRollback(async () => {
      const a = await insertUser();
      const caseA = await insertCase(a);
      const taskA = await insertTask(a, caseA);
      await insertReminder(a, taskA);
    });
  });

  it('deleting a case nulls only case_id; deleting a task removes its reminders', async () => {
    await inRollback(async () => {
      const a = await insertUser();
      const caseA = await insertCase(a);
      const taskA = await insertTask(a, caseA);
      await insertReminder(a, taskA);
      await client.query(`delete from public.cases where id = $1`, [caseA]);
      const t = await client.query<{ case_id: string | null; user_id: string }>(
        `select case_id, user_id from public.tasks where id = $1`,
        [taskA],
      );
      expect(t.rows[0]).toEqual({ case_id: null, user_id: a });
      await client.query(`delete from public.tasks where id = $1`, [taskA]);
      const r = await client.query(`select 1 from public.reminders where task_id = $1`, [taskA]);
      expect(r.rows).toHaveLength(0);
    });
  });

  it('creates a profile when an auth user is created', async () => {
    await inRollback(async () => {
      const userId = await insertUser();
      const { rows } = await client.query<{ timezone: string }>(
        `select timezone from public.profiles where id = $1`,
        [userId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.timezone).toBe('America/Sao_Paulo');
    });
  });
});
