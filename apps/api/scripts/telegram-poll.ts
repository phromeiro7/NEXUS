/*
 * Long polling local do Telegram, para desenvolvimento sem túnel: busca as atualizações com `getUpdates` e
 * repassa cada uma à rota `POST /telegram/webhook` da própria API (mesmo segredo, mesma lógica e mesma
 * semântica de reenvio: só avança quando a API responde 200; 5xx ou rede caída repetem a atualização).
 * Variáveis: TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET (obrigatórias) e TELEGRAM_POLL_URL
 * (padrão http://localhost:$PORT, com PORT padrão 3001). Ao iniciar apaga o webhook do bot: o Telegram não
 * entrega por `getUpdates` e por webhook ao mesmo tempo. Nunca imprime o token, o segredo nem o conteúdo das mensagens.
 */
import { pathToFileURL } from 'node:url';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Espera do `getUpdates`: o Telegram segura a resposta até esse tempo se não houver mensagem. */
const LONG_POLL_SECONDS = 30;
const BACKOFF_MS = 5_000;

export type PollConfig = { token: string; secret: string; webhookUrl: string };

/** Lê o ambiente; os erros nomeiam a variável e nunca incluem valores. */
export function buildPollConfig(env: Record<string, string | undefined>): PollConfig {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error('Variável de ambiente ausente: TELEGRAM_BOT_TOKEN');
  const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error('Variável de ambiente ausente: TELEGRAM_WEBHOOK_SECRET');
  const base = (env.TELEGRAM_POLL_URL?.trim() || `http://localhost:${env.PORT?.trim() || '3001'}`).replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error('TELEGRAM_POLL_URL inválida: esperada uma URL http(s) absoluta');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('TELEGRAM_POLL_URL inválida: esperada uma URL http(s) absoluta');
  }
  if (parsed.protocol === 'http:' && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error('TELEGRAM_POLL_URL inválida: fora de localhost use https');
  }
  return { token, secret, webhookUrl: `${base}/telegram/webhook` };
}

export type PollDeps = {
  config: PollConfig;
  fetch: typeof fetch;
  /** Espera `ms`; resolve `false` se o laço foi interrompido durante a espera. */
  sleep: (ms: number) => Promise<boolean>;
  signal: AbortSignal;
  log: (line: string) => void;
};

type Update = { update_id: number };

const isUpdate = (value: unknown): value is Update =>
  value !== null && typeof value === 'object' && typeof (value as { update_id?: unknown }).update_id === 'number';

const telegramUrl = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

/** Busca um lote. `undefined` = falha (rede, 409 de webhook ativo, corpo inesperado). */
async function fetchUpdates(deps: PollDeps, offset: number | undefined): Promise<unknown[] | undefined> {
  try {
    const res = await deps.fetch(telegramUrl(deps.config.token, 'getUpdates'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(offset !== undefined ? { offset } : {}),
        timeout: LONG_POLL_SECONDS,
        allowed_updates: ['message', 'callback_query'],
      }),
      signal: AbortSignal.any([deps.signal, AbortSignal.timeout((LONG_POLL_SECONDS + 15) * 1000)]),
    });
    const body: unknown = await res.json().catch(() => null);
    const result = (body as { ok?: unknown; result?: unknown } | null)?.result;
    return res.ok && (body as { ok?: unknown }).ok === true && Array.isArray(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

/** Entrega uma atualização à API. `true` = 200 (pode avançar); qualquer outra coisa repete. */
async function deliver(deps: PollDeps, update: unknown): Promise<boolean> {
  try {
    const res = await deps.fetch(deps.config.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': deps.config.secret },
      body: JSON.stringify(update),
      redirect: 'error',
      signal: AbortSignal.any([deps.signal, AbortSignal.timeout(60_000)]),
    });
    if (res.status !== 200) deps.log(`API respondeu HTTP ${res.status}; a atualização será repetida`);
    return res.status === 200;
  } catch {
    deps.log('Falha ao chamar a API local (está no ar?); a atualização será repetida');
    return false;
  }
}

/** Remove o webhook (o `getUpdates` falha com 409 enquanto ele existir). Mantém as atualizações pendentes. */
async function deleteWebhook(deps: PollDeps): Promise<boolean> {
  try {
    const res = await deps.fetch(telegramUrl(deps.config.token, 'deleteWebhook'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: false }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Roda até o sinal abortar. Devolve quantas atualizações foram entregues com sucesso. */
export async function pollLoop(deps: PollDeps): Promise<number> {
  let offset: number | undefined;
  let delivered = 0;
  while (!deps.signal.aborted) {
    const updates = await fetchUpdates(deps, offset);
    if (updates === undefined) {
      if (deps.signal.aborted) break;
      deps.log('getUpdates falhou (rede ou webhook ativo); nova tentativa em instantes');
      if (!(await deps.sleep(BACKOFF_MS))) break;
      continue;
    }
    for (const update of updates) {
      if (!isUpdate(update)) continue;
      if (!(await deliver(deps, update))) {
        // Não avança: o mesmo lote volta no próximo getUpdates (a API é idempotente por update_id).
        if (!(await deps.sleep(BACKOFF_MS))) return delivered;
        break;
      }
      offset = update.update_id + 1;
      delivered += 1;
    }
  }
  return delivered;
}

function abortableSleep(signal: AbortSignal): (ms: number) => Promise<boolean> {
  return (ms) =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve(false);
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve(true);
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve(false);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
}

export async function main(env: Record<string, string | undefined> = process.env): Promise<number> {
  let config: PollConfig;
  try {
    config = buildPollConfig(env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : 'Configuração inválida');
    return 1;
  }
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => controller.abort());
  const deps: PollDeps = {
    config,
    fetch,
    sleep: abortableSleep(controller.signal),
    signal: controller.signal,
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  };
  if (!(await deleteWebhook(deps))) {
    console.error('Não consegui apagar o webhook do bot (token inválido ou sem rede)');
    return 1;
  }
  console.log('Long polling do Telegram ativo, sem webhook (Ctrl+C para parar)');
  await pollLoop(deps);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
