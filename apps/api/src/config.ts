export type Config = {
  supabaseUrl: string;
  serviceRoleKey: string;
  port: number;
  webOrigin: string;
  /** Opcional: ausente = assistente indisponível ('configuracao'). Nunca logar. */
  anthropicApiKey?: string;
  assistantModel: string;
};

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

  // Origem do painel autorizada por CORS; vazio significa o padrão. Normalizada para a forma que o
  // navegador envia no header Origin (sem barra final nem caminho), senão nenhuma origem casaria.
  const rawOrigin = env.WEB_ORIGIN?.trim() || 'http://localhost:3000';
  let webOrigin: string;
  try {
    webOrigin = new URL(rawOrigin).origin;
  } catch {
    throw new Error('WEB_ORIGIN inválida: esperada uma URL absoluta, como https://painel.example.com');
  }
  // 'localhost:3000' é aceito por URL como esquema "localhost:", mas a origem resultante é opaca ('null').
  if (webOrigin === 'null') {
    throw new Error('WEB_ORIGIN inválida: esperada uma URL absoluta, como https://painel.example.com');
  }

  // A chave é opcional: sem ela a API sobe e o assistente responde 503 'configuracao'.
  const anthropicApiKey = env.ANTHROPIC_API_KEY?.trim() || undefined;
  const assistantModel = env.ASSISTANT_MODEL?.trim() || 'claude-haiku-5-5';

  return {
    supabaseUrl: env.SUPABASE_URL as string,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY as string,
    port,
    webOrigin,
    assistantModel,
    ...(anthropicApiKey !== undefined ? { anthropicApiKey } : {}),
  };
}
