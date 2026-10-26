export type Config = { supabaseUrl: string; serviceRoleKey: string; port: number; webOrigin: string };

/** Lê a configuração do ambiente. Nunca inclui valores (só nomes) nas mensagens de erro. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente ausentes: ${missing.join(', ')}`);
  }

  let port = 3001;
  if (env.PORT !== undefined) {
    if (!/^\d+$/.test(env.PORT)) throw new Error('PORT inválida: esperado um inteiro entre 1 e 65535');
    port = Number.parseInt(env.PORT, 10);
    if (port < 1 || port > 65535) throw new Error('PORT inválida: esperado um inteiro entre 1 e 65535');
  }

  // Origem do painel autorizada por CORS; vazio significa o padrão.
  const webOrigin = env.WEB_ORIGIN?.trim() || 'http://localhost:3000';

  return {
    supabaseUrl: env.SUPABASE_URL as string,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY as string,
    port,
    webOrigin,
  };
}
