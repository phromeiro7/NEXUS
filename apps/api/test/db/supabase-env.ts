import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export type SupabaseEnv = { url: string; anonKey: string; serviceRoleKey: string };

function fromCli(): Record<string, string> {
  const repoRoot = resolve(import.meta.dirname, '../../../..');
  const bin = resolve(import.meta.dirname, '../../node_modules/.bin/supabase');
  const out = execFileSync(bin, ['status', '-o', 'env', '--workdir', repoRoot], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const values: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const m = /^([A-Z0-9_]+)=(?:"(.*)"|(.*))$/.exec(line.trim());
    if (m) values[m[1]!] = m[2] ?? m[3] ?? '';
  }
  return values;
}

/** Local Supabase URL and keys: from the environment when set, otherwise `supabase status`. */
export function getSupabaseEnv(): SupabaseEnv {
  let url = process.env.SUPABASE_URL;
  let anonKey = process.env.SUPABASE_ANON_KEY;
  let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    try {
      const cli = fromCli();
      url ||= cli.API_URL;
      anonKey ||= cli.ANON_KEY;
      serviceRoleKey ||= cli.SERVICE_ROLE_KEY;
    } catch {
      // handled below
    }
  }
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      'Supabase local indisponivel: suba a stack (`supabase start`) ou defina ' +
        'SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  return { url, anonKey, serviceRoleKey };
}
