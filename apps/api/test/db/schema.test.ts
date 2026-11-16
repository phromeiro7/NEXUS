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
      'tasks',
      'reminders',
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

  async function insertTask(userId: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `insert into public.tasks (user_id, title) values ($1, 't') returning id`,
      [userId],
    );
    return rows[0]!.id;
  }

  async function insertReminder(userId: string, taskId: string): Promise<void> {
    await client.query(
      `insert into public.reminders (user_id, task_id, kind, scheduled_at) values ($1, $2, 'no_dia', now())`,
      [userId, taskId],
    );
  }

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
      const taskA = await insertTask(a);
      await insertReminder(a, taskA);
    });
  });

  it('deleting a task removes its reminders', async () => {
    await inRollback(async () => {
      const a = await insertUser();
      const taskA = await insertTask(a);
      await insertReminder(a, taskA);
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

  /**
   * Runs sql inside a savepoint (so the outer rolled-back transaction stays
   * usable) and asserts it fails with the given SQLSTATE and constraint name.
   */
  async function expectViolation(
    sql: string,
    params: unknown[],
    code: '23514' | '23505',
    constraint: string,
  ): Promise<void> {
    await client.query('savepoint violation');
    await expect(client.query(sql, params)).rejects.toMatchObject({ code, constraint });
    await client.query('rollback to savepoint violation');
  }

  describe('value checks', () => {
    it('rejects an unknown reminder kind', async () => {
      await inRollback(async () => {
        const a = await insertUser();
        const t = await insertTask(a);
        await expectViolation(
          `insert into public.reminders (user_id, task_id, kind, scheduled_at) values ($1, $2, 'semana_antes', now())`,
          [a, t],
          '23514',
          'reminders_kind_check',
        );
      });
    });

    it('defaults inbound_events.status to recebido and rejects unknown statuses', async () => {
      await inRollback(async () => {
        const { rows } = await client.query<{ status: string }>(
          `insert into public.inbound_events (channel, external_id) values ('telegram', $1) returning status`,
          [randomUUID()],
        );
        expect(rows[0]!.status).toBe('recebido');
        for (const status of ['processando', 'processado', 'falhou']) {
          await client.query(
            `insert into public.inbound_events (channel, external_id, status) values ('telegram', $1, $2)`,
            [randomUUID(), status],
          );
        }
        await expectViolation(
          `insert into public.inbound_events (channel, external_id, status) values ('telegram', $1, 'pendente')`,
          [randomUUID()],
          '23514',
          'inbound_events_status_check',
        );
      });
    });

    it('rejects an unknown channel on inbound_events, chat_messages and task_confirmations', async () => {
      await inRollback(async () => {
        const a = await insertUser();
        const t = await insertTask(a);
        await client.query(
          `insert into public.inbound_events (channel, external_id) values ('painel', $1)`,
          [randomUUID()],
        );
        await expectViolation(
          `insert into public.inbound_events (channel, external_id) values ('whatsapp', $1)`,
          [randomUUID()],
          '23514',
          'inbound_events_channel_check',
        );
        await client.query(
          `insert into public.chat_messages (user_id, channel, role, content) values ($1, 'painel', 'user', 'x')`,
          [a],
        );
        await expectViolation(
          `insert into public.chat_messages (user_id, channel, role, content) values ($1, 'whatsapp', 'user', 'x')`,
          [a],
          '23514',
          'chat_messages_channel_check',
        );
        await client.query(
          `insert into public.task_confirmations (channel, chat_id, message_id, task_id) values ('telegram', 1, 1, $1)`,
          [t],
        );
        await expectViolation(
          `insert into public.task_confirmations (channel, chat_id, message_id, task_id) values ('whatsapp', 1, 1, $1)`,
          [t],
          '23514',
          'task_confirmations_channel_check',
        );
      });
    });

    it('rejects a negative early_reminder_minutes', async () => {
      await inRollback(async () => {
        const a = await insertUser();
        await client.query(`update public.profiles set early_reminder_minutes = 0 where id = $1`, [a]);
        await expectViolation(
          `update public.profiles set early_reminder_minutes = -1 where id = $1`,
          [a],
          '23514',
          'profiles_early_reminder_minutes_check',
        );
      });
    });
  });

  describe('reminder uniqueness', () => {
    const insertKind = (userId: string, taskId: string, status: string) =>
      client.query(
        `insert into public.reminders (user_id, task_id, kind, scheduled_at, status) values ($1, $2, 'dia_anterior', now(), $3)`,
        [userId, taskId, status],
      );

    it('rejects a second active reminder of the same kind for the same task', async () => {
      await inRollback(async () => {
        const a = await insertUser();
        const t = await insertTask(a);
        await insertKind(a, t, 'pendente');
        for (const status of ['pendente', 'enviando']) {
          await expectViolation(
            `insert into public.reminders (user_id, task_id, kind, scheduled_at, status) values ($1, $2, 'dia_anterior', now(), $3)`,
            [a, t, status],
            '23505',
            'reminders_task_kind_active_key',
          );
        }
      });
    });

    it('allows a new pending reminder of the same kind once the earlier one was sent', async () => {
      await inRollback(async () => {
        const a = await insertUser();
        const t = await insertTask(a);
        await insertKind(a, t, 'enviado');
        await insertKind(a, t, 'pendente');
        const { rows } = await client.query(`select 1 from public.reminders where task_id = $1`, [t]);
        expect(rows).toHaveLength(2);
      });
    });
  });
});
