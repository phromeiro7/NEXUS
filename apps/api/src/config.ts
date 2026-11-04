export type Config = {
  supabaseUrl: string;
  serviceRoleKey: string;
  port: number;
  webOrigin: string;
  /** Opcional: ausente = assistente indisponível ('configuracao'). Nunca logar. */
  anthropicApiKey?: string;
  assistantModel: string;
  /** Opcional: ausente = envio de mensagens desabilitado. Nunca logar. */
  telegramBotToken?: string;
  /** Opcional: nome do bot sem '@' (usado no link de vinculação). */
  telegramBotUsername?: string;
  /** Opcional: ausente = webhook do Telegram desabilitado (503). Nunca logar. */
  telegramWebhookSecret?: string;
  /** Opcional: ausente = rotas internas desabilitadas (503). Nunca logar. */
  internalSecret?: string;
  /** Janela do `auth_date` do login pelo Telegram, em segundos (ausente = 3600). */
  telegramLoginMaxAgeSeconds?: number;
  /** Opcional: origem https do Mini App; habilita o botão "Ver no Nexus" nas respostas do bot. */
  miniAppUrl?: string;
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

  // Telegram e segredo interno: todos opcionais (vazio = ausente); a API sobe sem eles.
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN?.trim() || undefined;
  const telegramBotUsername = env.TELEGRAM_BOT_USERNAME?.trim() || undefined;
  const telegramWebhookSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined;
  const internalSecret = env.INTERNAL_SECRET?.trim() || undefined;
  // Só o formato que o Telegram aceita em secret_token; o erro cita o nome, nunca o valor.
  if (telegramWebhookSecret !== undefined && !/^[A-Za-z0-9_-]{1,256}$/.test(telegramWebhookSecret)) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET inválida: use de 1 a 256 caracteres entre letras, dígitos, _ e -');
  }
  // Segredos curtos são adivinháveis (a rota interna não tem limite de tentativas): mínimo de 16.
  for (const [name, value] of [
    ['TELEGRAM_WEBHOOK_SECRET', telegramWebhookSecret],
    ['INTERNAL_SECRET', internalSecret],
  ] as const) {
    if (value !== undefined && value.length < 16) {
      throw new Error(`${name} inválida: use pelo menos 16 caracteres (gere com openssl rand -hex 32)`);
    }
  }
  if (telegramBotUsername !== undefined && !/^[A-Za-z0-9_]{3,64}$/.test(telegramBotUsername)) {
    throw new Error('TELEGRAM_BOT_USERNAME inválida: use de 3 a 64 letras, dígitos ou _, sem @');
  }

  // Janela do `auth_date`: curta de propósito (o initData é um comprovante de quem abriu o app agora).
  let telegramLoginMaxAgeSeconds: number | undefined;
  const rawMaxAge = env.TELEGRAM_LOGIN_MAX_AGE_SECONDS?.trim();
  if (rawMaxAge !== undefined && rawMaxAge !== '') {
    const n = /^\d+$/.test(rawMaxAge) ? Number.parseInt(rawMaxAge, 10) : Number.NaN;
    if (!(n >= 60 && n <= 86_400)) {
      throw new Error('TELEGRAM_LOGIN_MAX_AGE_SECONDS inválida: use um inteiro de 60 a 86400');
    }
    telegramLoginMaxAgeSeconds = n;
  }

  // O botão web_app do Telegram só aceita https; guardamos a origem (sem barra final nem caminho).
  const rawMiniApp = env.MINI_APP_URL?.trim() || undefined;
  let miniAppUrl: string | undefined;
  if (rawMiniApp !== undefined) {
    let parsedMiniApp: URL | undefined;
    try {
      parsedMiniApp = new URL(rawMiniApp);
    } catch {
      parsedMiniApp = undefined;
    }
    if (parsedMiniApp === undefined || parsedMiniApp.protocol !== 'https:') {
      throw new Error('MINI_APP_URL inválida: esperada uma URL https absoluta, como https://nexus.example.com');
    }
    miniAppUrl = parsedMiniApp.origin;
  }

  return {
    supabaseUrl: env.SUPABASE_URL as string,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY as string,
    port,
    webOrigin,
    assistantModel,
    ...(telegramLoginMaxAgeSeconds !== undefined ? { telegramLoginMaxAgeSeconds } : {}),
    ...(anthropicApiKey !== undefined ? { anthropicApiKey } : {}),
    ...(telegramBotToken !== undefined ? { telegramBotToken } : {}),
    ...(telegramBotUsername !== undefined ? { telegramBotUsername } : {}),
    ...(telegramWebhookSecret !== undefined ? { telegramWebhookSecret } : {}),
    ...(internalSecret !== undefined ? { internalSecret } : {}),
    ...(miniAppUrl !== undefined ? { miniAppUrl } : {}),
  };
}
