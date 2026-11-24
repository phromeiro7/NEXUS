/*
 * Dispara uma passada do agendador local: POST /internal/reminders/run com o segredo do ambiente.
 * Variáveis: INTERNAL_SECRET (obrigatória) e REMINDERS_URL (padrão http://localhost:3001).
 * Imprime só o status HTTP e as contagens; nunca o segredo. Não segue redirecionamentos (o cabeçalho
 * personalizado seria reenviado ao destino) e recusa `http:` fora de localhost.
 */
import { pathToFileURL } from 'node:url';

/** Requisição pronta para o `fetch` da passada do agendador. */
export type TickRequest = {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; redirect: 'error' };
};

/** Únicos hosts em que `http:` é aceito (o segredo não sai da máquina). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEFAULT_REMINDERS_URL = 'http://localhost:3001';
const SCHEDULER_PATH = '/internal/reminders/run';
const INVALID_URL_MESSAGE = 'REMINDERS_URL inválida: esperada uma URL http(s) absoluta';

/** Lê o ambiente; os erros nomeiam a variável e nunca incluem valores. */
export function buildTickRequest(env: Record<string, string | undefined>): TickRequest {
  const secret = env.INTERNAL_SECRET?.trim();
  if (!secret) throw new Error('Variável de ambiente ausente: INTERNAL_SECRET');
  // Sem barras finais, para não gerar `//internal` ao concatenar o caminho.
  const baseUrl = (env.REMINDERS_URL?.trim() || DEFAULT_REMINDERS_URL).replace(/\/+$/, '');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error(INVALID_URL_MESSAGE);
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(INVALID_URL_MESSAGE);
  }
  if (parsedUrl.protocol === 'http:' && !LOOPBACK_HOSTS.has(parsedUrl.hostname)) {
    throw new Error('REMINDERS_URL inválida: fora de localhost use https');
  }
  return {
    url: `${baseUrl}${SCHEDULER_PATH}`,
    init: { method: 'POST', headers: { 'X-Internal-Secret': secret }, redirect: 'error' },
  };
}

/** Chaves numéricas conhecidas do resultado do agendador; qualquer outra coisa é descartada. */
const COUNT_KEYS = {
  reminders: ['sent', 'retried', 'failed', 'cancelled', 'recovered', 'paused', 'leaseLost', 'deferred'],
  briefings: ['sent', 'skippedEmpty', 'retried', 'failed', 'paused', 'deferred'],
  eventsRecovered: ['recovered', 'failed'],
  purged: ['chatMessages', 'linkCodes', 'modelCalls', 'chatCaptures', 'telegramAuth', 'qrLogin'],
} as const;

/** Códigos de erro fixos da rota interna; só estes podem ser impressos. */
const KNOWN_ERROR_CODES = new Set(['nao_autenticado', 'agendador_desabilitado']);

/** JSON inválido vira `undefined` em vez de lançar. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** O valor como objeto simples, ou `undefined` se for outra coisa (lista, primitivo, null). */
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/**
 * 200: só as contagens conhecidas (números). Outros status: só o código e, se for um dos códigos
 * fixos da API, o `error`. Nada do corpo além disso é impresso (um serviço que ecoa o segredo não o vaza).
 */
export function formatTickOutput(status: number, bodyText: string): string {
  const body = asRecord(parseJson(bodyText));
  if (status !== 200) {
    const errorCode = body?.error;
    const isKnownErrorCode = typeof errorCode === 'string' && KNOWN_ERROR_CODES.has(errorCode);
    return isKnownErrorCode ? `HTTP ${status}\n${errorCode}` : `HTTP ${status}`;
  }
  if (body === undefined) return 'HTTP 200\n(sem JSON)';
  const counts: Record<string, Record<string, number>> = {};
  for (const [group, keys] of Object.entries(COUNT_KEYS)) {
    const groupBody = asRecord(body[group]);
    if (groupBody === undefined) continue;
    const groupCounts: Record<string, number> = {};
    for (const key of keys) {
      const value = groupBody[key];
      if (typeof value === 'number' && Number.isFinite(value)) groupCounts[key] = value;
    }
    counts[group] = groupCounts;
  }
  return `HTTP 200\n${JSON.stringify(counts)}`;
}

/** Entrada do script: faz uma passada e devolve o código de saída (0 = HTTP 200). */
export async function main(env: Record<string, string | undefined> = process.env): Promise<number> {
  let request: TickRequest;
  try {
    request = buildTickRequest(env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Configuração inválida');
    return 1;
  }
  try {
    const response = await fetch(request.url, request.init);
    console.log(formatTickOutput(response.status, await response.text()));
    return response.status === 200 ? 0 : 1;
  } catch {
    // Sem a mensagem do erro: URL de redirecionamento e segredo não devem aparecer.
    console.error('Falha ao chamar o agendador (a API está no ar? houve redirecionamento?)');
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
