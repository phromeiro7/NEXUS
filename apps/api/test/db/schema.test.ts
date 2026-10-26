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
      ).rejects.toMatchObject({ code: '23514' });
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
