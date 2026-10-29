import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Generic catalog checks for schema `public`. They read pg_class / pg_proc /
 * pg_default_acl instead of a hard-coded table list, so a table or function
 * added later without RLS and revokes makes this suite fail.
 */

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

const client = new pg.Client({ connectionString });

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

const ALL_TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
const AUTHENTICATED_FORBIDDEN = ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];

/**
 * Owner roles whose default ACLs in `public` the migration role (`postgres`)
 * cannot alter: `alter default privileges for role supabase_admin` fails with
 * "permission denied to change default privileges". They only apply to
 * objects supabase_admin creates; the test below asserts it owns none.
 */
const UNALTERABLE_DEFAULT_ACL_OWNERS = ['supabase_admin'];

type Violation = { object: string; problem: string };

/** Every table in `public` without RLS, or with privileges anon/authenticated must not have. */
async function tableViolations(): Promise<Violation[]> {
  const { rows } = await client.query<{ object: string; problem: string }>(
    `
    with t as (
      select c.oid, c.relname, c.relrowsecurity
      from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    )
    select relname as object, 'rls disabled' as problem from t where not relrowsecurity
    union all
    select t.relname, 'anon has ' || p.priv
    from t cross join unnest($1::text[]) as p(priv)
    where has_table_privilege('anon', t.oid, p.priv)
    union all
    select t.relname, 'anon has a column privilege'
    from t
    where has_any_column_privilege('anon', t.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
    union all
    select t.relname, 'authenticated has ' || p.priv
    from t cross join unnest($2::text[]) as p(priv)
    where has_table_privilege('authenticated', t.oid, p.priv)
    union all
    select t.relname, 'authenticated has column REFERENCES'
    from t
    where has_any_column_privilege('authenticated', t.oid, 'REFERENCES')
    order by 1, 2
    `,
    [ALL_TABLE_PRIVILEGES, AUTHENTICATED_FORBIDDEN],
  );
  return rows;
}

/** Every function in `public` that anon or authenticated can execute (directly or via PUBLIC). */
async function functionViolations(): Promise<Violation[]> {
  const { rows } = await client.query<{ object: string; problem: string }>(`
    select p.oid::regprocedure::text as object, r.role || ' can execute' as problem
    from pg_proc p cross join (values ('anon'), ('authenticated')) as r(role)
    where p.pronamespace = 'public'::regnamespace
      and has_function_privilege(r.role, p.oid, 'EXECUTE')
    order by 1, 2
  `);
  return rows;
}

/** Inside a transaction that is always rolled back. */
async function inRollback(fn: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await fn();
  } finally {
    await client.query('rollback');
  }
}

describe('catalog: public schema', () => {
  it('finds the tables to check (sanity)', async () => {
    const { rows } = await client.query(
      `select 1 from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p')`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(9);
  });

  it('every table has RLS, nothing for anon, no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN for authenticated', async () => {
    expect(await tableViolations()).toEqual([]);
  });

  it('no function in public is executable by anon or authenticated', async () => {
    const { rows } = await client.query(`select 1 from pg_proc where pronamespace = 'public'::regnamespace`);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(await functionViolations()).toEqual([]);
  });

  it('default privileges in public grant nothing to anon/authenticated for alterable owners', async () => {
    const { rows } = await client.query<{ owner: string; objtype: string; grantee: string }>(`
      select pg_get_userbyid(d.defaclrole) as owner, d.defaclobjtype as objtype,
             case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end as grantee
      from pg_default_acl d, aclexplode(d.defaclacl) a
      where (d.defaclnamespace = 'public'::regnamespace or d.defaclnamespace = 0)
        and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
      order by 1, 2, 3
    `);
    const alterable = rows.filter((r) => !UNALTERABLE_DEFAULT_ACL_OWNERS.includes(r.owner));
    expect(alterable).toEqual([]);
  });

  it('no table or function in public is owned by a role whose default ACLs we cannot alter', async () => {
    const { rows } = await client.query(
      `
      select relname as name from pg_class
      where relnamespace = 'public'::regnamespace and pg_get_userbyid(relowner) = any($1::text[])
      union all
      select proname from pg_proc
      where pronamespace = 'public'::regnamespace and pg_get_userbyid(proowner) = any($1::text[])
      `,
      [UNALTERABLE_DEFAULT_ACL_OWNERS],
    );
    expect(rows).toEqual([]);
  });

  it('service_role keeps its default privileges from postgres in public', async () => {
    const { rows } = await client.query<{ objtype: string; privs: string }>(`
      select d.defaclobjtype as objtype, string_agg(a.privilege_type, ',' order by a.privilege_type) as privs
      from pg_default_acl d, aclexplode(d.defaclacl) a
      where d.defaclnamespace = 'public'::regnamespace
        and d.defaclrole = 'postgres'::regrole
        and a.grantee = 'service_role'::regrole
      group by 1 order by 1
    `);
    expect(rows).toEqual([
      { objtype: 'S', privs: 'SELECT,UPDATE,USAGE' },
      { objtype: 'f', privs: 'EXECUTE' },
      { objtype: 'r', privs: 'DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE' },
    ]);
  });

  it('detects a table and a function added without RLS/revokes (probe, rolled back)', async () => {
    await inRollback(async () => {
      await client.query(`create table public.zz_catalog_probe (id int)`);
      await client.query(`grant select on public.zz_catalog_probe to anon`);
      await client.query(`create function public.zz_catalog_probe_fn() returns int language sql as 'select 1'`);
      await client.query(`grant execute on function public.zz_catalog_probe_fn() to authenticated`);

      const tables = (await tableViolations()).filter((v) => v.object === 'zz_catalog_probe');
      expect(tables).toEqual(
        expect.arrayContaining([
          { object: 'zz_catalog_probe', problem: 'rls disabled' },
          { object: 'zz_catalog_probe', problem: 'anon has SELECT' },
        ]),
      );
      const fns = (await functionViolations()).filter((v) => v.object.startsWith('zz_catalog_probe_fn'));
      expect(fns).toContainEqual({ object: 'zz_catalog_probe_fn()', problem: 'authenticated can execute' });
    });
  });

  it('a table or function created by postgres in public gets no anon/authenticated grants by default', async () => {
    await inRollback(async () => {
      await client.query(`create table public.zz_default_probe (id int)`);
      await client.query(`alter table public.zz_default_probe enable row level security`);
      await client.query(`create sequence public.zz_default_probe_seq`);
      await client.query(`create function public.zz_default_probe_fn() returns int language sql as 'select 1'`);

      expect((await tableViolations()).filter((v) => v.object === 'zz_default_probe')).toEqual([]);
      expect(await functionViolations()).toEqual([]);
      const { rows } = await client.query<{ role: string; usable: boolean }>(`
        select r.role, has_sequence_privilege(r.role, 'public.zz_default_probe_seq', 'USAGE, SELECT, UPDATE') as usable
        from (values ('anon'), ('authenticated')) as r(role) order by 1
      `);
      expect(rows).toEqual([
        { role: 'anon', usable: false },
        { role: 'authenticated', usable: false },
      ]);
      // service_role still gets its grants on new objects.
      const sr = await client.query<{ t: boolean; f: boolean }>(`
        select (has_table_privilege('service_role', 'public.zz_default_probe', 'SELECT')
                and has_table_privilege('service_role', 'public.zz_default_probe', 'INSERT')
                and has_table_privilege('service_role', 'public.zz_default_probe', 'UPDATE')
                and has_table_privilege('service_role', 'public.zz_default_probe', 'DELETE')) as t,
               has_function_privilege('service_role', 'public.zz_default_probe_fn()', 'EXECUTE') as f
      `);
      expect(sr.rows[0]).toEqual({ t: true, f: true });
    });
  });
});
