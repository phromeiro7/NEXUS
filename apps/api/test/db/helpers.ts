import { randomUUID } from 'node:crypto';
import pg from 'pg';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

/** Admin connection pool (the local `postgres` role, which bypasses RLS). */
export const pool = new pg.Pool({ connectionString, max: 4 });

export type Query = (sql: string, params?: unknown[]) => Promise<pg.QueryResult>;

const createdUsers = new Set<string>();

/**
 * Inserts a row into auth.users with the admin connection (committed). The
 * on_auth_user_created trigger creates the matching profile. Call
 * deleteCreatedUsers() in afterAll to remove the users and, by cascade, every
 * row they own.
 */
export async function createUser(): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
    [id, `${id}@example.test`],
  );
  createdUsers.add(id);
  return id;
}

/** Deletes every auth user created by createUser (cascades to profiles and owned rows). */
export async function deleteCreatedUsers(): Promise<void> {
  if (createdUsers.size === 0) return;
  await pool.query(`delete from auth.users where id = any($1::uuid[])`, [[...createdUsers]]);
  createdUsers.clear();
}

/** Ends the admin pool. Call once, after deleteCreatedUsers. */
export async function closePool(): Promise<void> {
  await pool.end();
}

/**
 * Runs fn inside a transaction as the given database role with the given JWT
 * claims, the same way PostgREST does. The transaction is always rolled back.
 */
async function asRole<T>(
  role: 'authenticated' | 'anon' | 'service_role',
  claims: Record<string, unknown>,
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(claims),
    ]);
    // Role names are a fixed union above, never user input.
    await client.query(`set local role ${role}`);
    return await fn((sql, params) => client.query(sql, params));
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

/** Runs fn as `authenticated` with auth.uid() = userId; always rolled back. */
export function asUser<T>(userId: string, fn: (q: Query) => Promise<T>): Promise<T> {
  return asRole('authenticated', { sub: userId, role: 'authenticated' }, fn);
}

/** Runs fn as `anon` (no user); always rolled back. */
export function asAnon<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  return asRole('anon', { role: 'anon' }, fn);
}

/** Runs fn as `service_role` (what the API server uses); always rolled back. */
export function asServiceRole<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  return asRole('service_role', { role: 'service_role' }, fn);
}
