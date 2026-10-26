import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asAnon,
  asServiceRole,
  asUser,
  closePool,
  createUser,
  deleteCreatedUsers,
  pool,
} from './helpers.js';

const DENIED = { code: '42501' };

const ALL_TABLES = [
  'profiles',
  'cases',
  'tasks',
  'reminders',
  'holidays',
  'inbound_events',
  'chat_messages',
  'link_codes',
  'task_confirmations',
] as const;

const INTERNAL_TABLES = ['inbound_events', 'chat_messages', 'link_codes', 'task_confirmations'];

interface Fixture {
  id: string;
  caseId: string;
  taskId: string;
  reminderId: string;
  holidayId: string;
}

let a: Fixture;
let b: Fixture;

async function seed(): Promise<Fixture> {
  const id = await createUser();
  const c = await pool.query<{ id: string }>(
    `insert into public.cases (user_id, number, client_name) values ($1, $2, 'Cliente Sigiloso') returning id`,
    [id, randomUUID()],
  );
  const caseId = c.rows[0]!.id;
  const t = await pool.query<{ id: string }>(
    `insert into public.tasks (user_id, case_id, title, due_date) values ($1, $2, 'Contestação', '2026-11-10') returning id`,
    [id, caseId],
  );
  const taskId = t.rows[0]!.id;
  const r = await pool.query<{ id: string }>(
    `insert into public.reminders (user_id, task_id, kind, scheduled_at) values ($1, $2, 'no_dia', now()) returning id`,
    [id, taskId],
  );
  const h = await pool.query<{ id: string }>(
    `insert into public.holidays (user_id, date, scope, name) values ($1, '2026-12-08', 'municipal', 'Padroeira') returning id`,
    [id],
  );
  // Internal (service-role only) rows, so a leak would be visible.
  await pool.query(
    `insert into public.inbound_events (channel, external_id, user_id) values ('telegram', $1, $2)`,
    [randomUUID(), id],
  );
  await pool.query(
    `insert into public.chat_messages (user_id, channel, role, content) values ($1, 'telegram', 'user', 'segredo')`,
    [id],
  );
  await pool.query(
    `insert into public.link_codes (code, user_id, expires_at) values ($1, $2, now() + interval '10 minutes')`,
    [randomUUID(), id],
  );
  await pool.query(
    `insert into public.task_confirmations (channel, chat_id, message_id, task_id) values ('telegram', 1, $1, $2)`,
    [Math.floor(Math.random() * 1e9), taskId],
  );
  return { id, caseId, taskId, reminderId: r.rows[0]!.id, holidayId: h.rows[0]!.id };
}

beforeAll(async () => {
  a = await seed();
  b = await seed();
});

afterAll(async () => {
  await deleteCreatedUsers();
  await closePool();
});

describe('rls: setup', () => {
  it('has row level security enabled on every table in public', async () => {
    const { rows } = await pool.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')`,
    );
    for (const t of ALL_TABLES) expect(rows.map((r) => r.relname)).toContain(t);
    expect(rows.filter((r) => !r.relrowsecurity)).toEqual([]);
  });

  it('grants exactly the expected table privileges', async () => {
    const privs = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
    const expected: Record<string, Record<string, string[]>> = {
      anon: Object.fromEntries(ALL_TABLES.map((t) => [t, []])),
      authenticated: {
        profiles: ['SELECT'],
        cases: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        tasks: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        holidays: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        reminders: ['SELECT'],
        inbound_events: [],
        chat_messages: [],
        link_codes: [],
        task_confirmations: [],
      },
      service_role: Object.fromEntries(ALL_TABLES.map((t) => [t, privs])),
    };
    for (const [role, tables] of Object.entries(expected)) {
      for (const [table, want] of Object.entries(tables)) {
        const { rows } = await pool.query<{ p: string }>(
          `select p from unnest($3::text[]) p where has_table_privilege($1, $2, p)`,
          [role, `public.${table}`, privs],
        );
        expect({ role, table, privs: rows.map((r) => r.p) }).toEqual({ role, table, privs: want });
      }
    }
  });

  it('lets authenticated update only the editable profile columns', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles'
          and has_column_privilege('authenticated', 'public.profiles', column_name, 'UPDATE')
        order by column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'briefing_time',
      'city',
      'early_reminder_minutes',
      'timezone',
      'uf',
    ]);
    const anon = await pool.query(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles'
          and (has_column_privilege('anon', 'public.profiles', column_name, 'SELECT')
            or has_column_privilege('anon', 'public.profiles', column_name, 'UPDATE')
            or has_column_privilege('anon', 'public.profiles', column_name, 'INSERT'))`,
    );
    expect(anon.rows).toEqual([]);
  });
});

describe('rls: own data (positive controls)', () => {
  it('A sees exactly its own task, case, profile, reminder and holiday', async () => {
    await asUser(a.id, async (q) => {
      expect((await q(`select id from public.tasks`)).rows).toEqual([{ id: a.taskId }]);
      expect((await q(`select id from public.cases`)).rows).toEqual([{ id: a.caseId }]);
      expect((await q(`select id from public.profiles`)).rows).toEqual([{ id: a.id }]);
      expect((await q(`select id from public.reminders`)).rows).toEqual([{ id: a.reminderId }]);
      expect((await q(`select id from public.holidays`)).rows).toEqual([{ id: a.holidayId }]);
    });
  });

  it('A can insert, update and delete its own case, task and holiday', async () => {
    await asUser(a.id, async (q) => {
      const c = await q(
        `insert into public.cases (user_id, number) values ($1, 'novo') returning id`,
        [a.id],
      );
      const t = await q(
        `insert into public.tasks (user_id, case_id, title) values ($1, $2, 'nova') returning id`,
        [a.id, c.rows[0].id],
      );
      const h = await q(
        `insert into public.holidays (user_id, date, scope, name) values ($1, '2026-01-20', 'municipal', 'x') returning id`,
        [a.id],
      );
      expect((await q(`update public.tasks set title = 'editada' where id = $1`, [t.rows[0].id])).rowCount).toBe(1);
      expect((await q(`update public.cases set status = 'arquivado' where id = $1`, [c.rows[0].id])).rowCount).toBe(1);
      expect((await q(`update public.holidays set name = 'y' where id = $1`, [h.rows[0].id])).rowCount).toBe(1);
      expect((await q(`delete from public.tasks where id = $1`, [t.rows[0].id])).rowCount).toBe(1);
      expect((await q(`delete from public.cases where id = $1`, [c.rows[0].id])).rowCount).toBe(1);
      expect((await q(`delete from public.holidays where id = $1`, [h.rows[0].id])).rowCount).toBe(1);
    });
  });

  it('A can update its own timezone', async () => {
    await asUser(a.id, async (q) => {
      const r = await q(`update public.profiles set timezone = 'America/Recife' where id = $1`, [a.id]);
      expect(r.rowCount).toBe(1);
      const s = await q(`select timezone from public.profiles where id = $1`, [a.id]);
      expect(s.rows).toEqual([{ timezone: 'America/Recife' }]);
    });
  });

  it('A can update every editable profile column at once', async () => {
    await asUser(a.id, async (q) => {
      const r = await q(
        `update public.profiles
            set uf = 'PE', city = 'Recife', early_reminder_minutes = 30, briefing_time = '07:30'`,
      );
      expect(r.rowCount).toBe(1);
    });
  });
});

describe('rls: isolation between users', () => {
  it('B sees none of A\'s tasks, cases, profile, reminders or holidays', async () => {
    await asUser(b.id, async (q) => {
      expect((await q(`select 1 from public.tasks where user_id = $1`, [a.id])).rowCount).toBe(0);
      expect((await q(`select 1 from public.tasks where id = $1`, [a.taskId])).rowCount).toBe(0);
      expect((await q(`select 1 from public.cases where id = $1`, [a.caseId])).rowCount).toBe(0);
      expect((await q(`select 1 from public.profiles where id = $1`, [a.id])).rowCount).toBe(0);
      expect((await q(`select 1 from public.reminders where id = $1`, [a.reminderId])).rowCount).toBe(0);
      expect((await q(`select 1 from public.holidays where id = $1`, [a.holidayId])).rowCount).toBe(0);
      // And only its own rows overall.
      expect((await q(`select user_id from public.tasks`)).rows).toEqual([{ user_id: b.id }]);
    });
  });

  it('B cannot update A\'s task, case, holiday or profile (0 rows)', async () => {
    await asUser(b.id, async (q) => {
      expect((await q(`update public.tasks set title = 'hack' where id = $1`, [a.taskId])).rowCount).toBe(0);
      expect((await q(`update public.tasks set title = 'hack'`)).rowCount).toBe(1); // only B's own
      expect((await q(`update public.cases set client_name = 'hack' where id = $1`, [a.caseId])).rowCount).toBe(0);
      expect((await q(`update public.holidays set name = 'hack' where id = $1`, [a.holidayId])).rowCount).toBe(0);
      expect((await q(`update public.profiles set timezone = 'UTC' where id = $1`, [a.id])).rowCount).toBe(0);
    });
    const t = await pool.query(`select title from public.tasks where id = $1`, [a.taskId]);
    expect(t.rows).toEqual([{ title: 'Contestação' }]);
  });

  it('B cannot delete A\'s task, case or holiday (0 rows)', async () => {
    await asUser(b.id, async (q) => {
      expect((await q(`delete from public.tasks where id = $1`, [a.taskId])).rowCount).toBe(0);
      expect((await q(`delete from public.cases where id = $1`, [a.caseId])).rowCount).toBe(0);
      expect((await q(`delete from public.holidays where id = $1`, [a.holidayId])).rowCount).toBe(0);
    });
  });

  it('B cannot insert a task owned by A', async () => {
    await expect(
      asUser(b.id, (q) => q(`insert into public.tasks (user_id, title) values ($1, 'x')`, [a.id])),
    ).rejects.toMatchObject(DENIED);
  });

  it('B cannot insert a case or holiday owned by A', async () => {
    await expect(
      asUser(b.id, (q) => q(`insert into public.cases (user_id, number) values ($1, 'x')`, [a.id])),
    ).rejects.toMatchObject(DENIED);
    await expect(
      asUser(b.id, (q) =>
        q(
          `insert into public.holidays (user_id, date, scope, name) values ($1, '2026-02-02', 'estadual', 'x')`,
          [a.id],
        ),
      ),
    ).rejects.toMatchObject(DENIED);
  });

  it('A cannot hand its own task, case or holiday over to B', async () => {
    await expect(
      asUser(a.id, (q) =>
        q(`update public.tasks set user_id = $1, case_id = null where id = $2`, [b.id, a.taskId]),
      ),
    ).rejects.toMatchObject(DENIED);
    await expect(
      asUser(a.id, (q) => q(`update public.cases set user_id = $1 where id = $2`, [b.id, a.caseId])),
    ).rejects.toMatchObject(DENIED);
    await expect(
      asUser(a.id, (q) =>
        q(`update public.holidays set user_id = $1 where id = $2`, [b.id, a.holidayId]),
      ),
    ).rejects.toMatchObject(DENIED);
  });

  it('A cannot link its task to B\'s case', async () => {
    await expect(
      asUser(a.id, (q) => q(`update public.tasks set case_id = $1 where id = $2`, [b.caseId, a.taskId])),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

describe('rls: profiles', () => {
  it('A cannot set its own telegram_chat_id', async () => {
    await expect(
      asUser(a.id, (q) => q(`update public.profiles set telegram_chat_id = 123 where id = $1`, [a.id])),
    ).rejects.toMatchObject(DENIED);
  });

  it('A cannot set channel_paused, last_briefing_sent_on, id or created_at', async () => {
    for (const set of [
      `channel_paused = true`,
      `last_briefing_sent_on = '2026-10-26'`,
      `id = '${b.id}'`,
      `created_at = now()`,
    ]) {
      await expect(
        asUser(a.id, (q) => q(`update public.profiles set ${set} where id = $1`, [a.id])),
      ).rejects.toMatchObject(DENIED);
    }
  });

  it('authenticated cannot insert or delete profiles', async () => {
    await expect(
      asUser(a.id, (q) => q(`insert into public.profiles (id) values ($1)`, [randomUUID()])),
    ).rejects.toMatchObject(DENIED);
    await expect(
      asUser(a.id, (q) => q(`delete from public.profiles where id = $1`, [a.id])),
    ).rejects.toMatchObject(DENIED);
  });
});

describe('rls: reminders are read-only for users', () => {
  it('A cannot insert, update or delete reminders, even its own', async () => {
    await expect(
      asUser(a.id, (q) =>
        q(
          `insert into public.reminders (user_id, task_id, kind, scheduled_at) values ($1, $2, 'x', now())`,
          [a.id, a.taskId],
        ),
      ),
    ).rejects.toMatchObject(DENIED);
    await expect(
      asUser(a.id, (q) => q(`update public.reminders set status = 'cancelado' where id = $1`, [a.reminderId])),
    ).rejects.toMatchObject(DENIED);
    await expect(
      asUser(a.id, (q) => q(`delete from public.reminders where id = $1`, [a.reminderId])),
    ).rejects.toMatchObject(DENIED);
  });
});

describe('rls: internal tables', () => {
  for (const table of INTERNAL_TABLES) {
    it(`authenticated cannot select, update or delete ${table}`, async () => {
      for (const sql of [
        `select * from public.${table}`,
        `update public.${table} set created_at = now()`,
        `delete from public.${table}`,
      ]) {
        await expect(asUser(a.id, (q) => q(sql))).rejects.toMatchObject(DENIED);
      }
    });
  }

  it('authenticated cannot insert into internal tables', async () => {
    for (const [sql, params] of [
      [`insert into public.inbound_events (channel, external_id, user_id) values ('telegram', 'x', $1)`, [a.id]],
      [`insert into public.chat_messages (user_id, channel, role, content) values ($1, 'telegram', 'user', 'x')`, [a.id]],
      [`insert into public.link_codes (code, user_id, expires_at) values ('x', $1, now())`, [a.id]],
      [`insert into public.task_confirmations (channel, chat_id, message_id, task_id) values ('telegram', 1, 1, $1)`, [a.taskId]],
    ] as const) {
      await expect(asUser(a.id, (q) => q(sql, [...params]))).rejects.toMatchObject(DENIED);
    }
  });

  it('authenticated cannot truncate any table (truncate bypasses RLS)', async () => {
    for (const table of ALL_TABLES) {
      await expect(asUser(a.id, (q) => q(`truncate public.${table} cascade`))).rejects.toMatchObject(
        DENIED,
      );
    }
  });
});

describe('rls: anon', () => {
  for (const table of ALL_TABLES) {
    it(`anon cannot read ${table}`, async () => {
      await expect(asAnon((q) => q(`select * from public.${table}`))).rejects.toMatchObject(DENIED);
    });
  }

  it('anon cannot write tasks', async () => {
    await expect(
      asAnon((q) => q(`insert into public.tasks (user_id, title) values ($1, 'x')`, [a.id])),
    ).rejects.toMatchObject(DENIED);
    await expect(asAnon((q) => q(`update public.tasks set title = 'x'`))).rejects.toMatchObject(DENIED);
    await expect(asAnon((q) => q(`delete from public.tasks`))).rejects.toMatchObject(DENIED);
  });
});

describe('rls: service_role (the API path) keeps full access', () => {
  it('reads every table across users', async () => {
    await asServiceRole(async (q) => {
      const t = await q(`select user_id from public.tasks where user_id = any($1::uuid[])`, [[a.id, b.id]]);
      expect(t.rowCount).toBe(2);
      const p = await q(`select id from public.profiles where id = any($1::uuid[])`, [[a.id, b.id]]);
      expect(p.rowCount).toBe(2);
      for (const table of ALL_TABLES) {
        await q(`select count(*) from public.${table}`);
      }
      const cm = await q(`select 1 from public.chat_messages where user_id = any($1::uuid[])`, [[a.id, b.id]]);
      expect(cm.rowCount).toBe(2);
    });
  });

  it('writes across users, including internal tables and protected profile columns', async () => {
    await asServiceRole(async (q) => {
      const t = await q(`insert into public.tasks (user_id, title) values ($1, 'via api') returning id`, [a.id]);
      await q(
        `insert into public.reminders (user_id, task_id, kind, scheduled_at) values ($1, $2, 'no_dia', now())`,
        [a.id, t.rows[0].id],
      );
      expect((await q(`update public.tasks set title = 'x' where id = $1`, [b.taskId])).rowCount).toBe(1);
      expect(
        (await q(`update public.profiles set telegram_chat_id = $1, channel_paused = true where id = $2`, [
          Math.floor(Math.random() * 1e12),
          a.id,
        ])).rowCount,
      ).toBe(1);
      expect((await q(`update public.reminders set status = 'enviado' where id = $1`, [b.reminderId])).rowCount).toBe(1);
      await q(`insert into public.chat_messages (user_id, channel, role, content) values ($1, 'telegram', 'assistant', 'ok')`, [b.id]);
      await q(`insert into public.inbound_events (channel, external_id) values ('telegram', $1)`, [randomUUID()]);
      await q(`insert into public.link_codes (code, user_id, expires_at) values ($1, $2, now())`, [randomUUID(), b.id]);
      await q(
        `insert into public.task_confirmations (channel, chat_id, message_id, task_id) values ('telegram', 2, 2, $1)`,
        [b.taskId],
      );
      expect((await q(`delete from public.link_codes where user_id = $1`, [a.id])).rowCount).toBe(1);
      expect((await q(`delete from public.holidays where id = $1`, [b.holidayId])).rowCount).toBe(1);
    });
  });
});
