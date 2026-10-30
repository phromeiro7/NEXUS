/*
 * Dispara uma passada do agendador local: POST /internal/reminders/run com o segredo do ambiente.
 * Variáveis: INTERNAL_SECRET (obrigatória) e REMINDERS_URL (padrão http://localhost:3001).
 * Imprime só o status HTTP e as contagens; nunca o segredo. Não segue redirecionamentos (o cabeçalho
 * personalizado seria reenviado ao destino) e recusa `http:` fora de localhost.
 */
import { pathToFileURL } from 'node:url';

export type TickRequest = {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; redirect: 'error' };
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Lê o ambiente; os erros nomeiam a variável e nunca incluem valores. */
export function buildTickRequest(env: Record<string, string | undefined>): TickRequest {
  const secret = env.INTERNAL_SECRET?.trim();
  if (!secret) throw new Error('Variável de ambiente ausente: INTERNAL_SECRET');
  const base = (env.REMINDERS_URL?.trim() || 'http://localhost:3001').replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error('REMINDERS_URL inválida: esperada uma URL http(s) absoluta');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('REMINDERS_URL inválida: esperada uma URL http(s) absoluta');
  }
  if (parsed.protocol === 'http:' && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error('REMINDERS_URL inválida: fora de localhost use https');
  }
  return {
    url: `${base}/internal/reminders/run`,
    init: { method: 'POST', headers: { 'X-Internal-Secret': secret }, redirect: 'error' },
  };
}

/** Chaves numéricas conhecidas do resultado do agendador; qualquer outra coisa é descartada. */
const COUNT_KEYS = {
  reminders: ['sent', 'retried', 'failed', 'cancelled', 'recovered', 'paused', 'leaseLost', 'deferred'],
  briefings: ['sent', 'skippedEmpty', 'retried', 'failed', 'paused', 'deferred'],
  eventsRecovered: ['recovered', 'failed'],
  purged: ['chatMessages', 'linkCodes', 'modelCalls'],
} as const;

const KNOWN_ERROR_CODES = new Set(['nao_autenticado', 'agendador_desabilitado']);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/**
 * 200: só as contagens conhecidas (números). Outros status: só o código e, se for um dos códigos
 * fixos da API, o `error`. Nada do corpo além disso é impresso (um serviço que ecoa o segredo não o vaza).
 */
export function formatTickOutput(status: number, bodyText: string): string {
  const body = asRecord(parseJson(bodyText));
  if (status !== 200) {
    const code = body?.error;
    return typeof code === 'string' && KNOWN_ERROR_CODES.has(code) ? `HTTP ${status}\n${code}` : `HTTP ${status}`;
  }
  if (body === undefined) return 'HTTP 200\n(sem JSON)';
  const counts: Record<string, Record<string, number>> = {};
  for (const [group, keys] of Object.entries(COUNT_KEYS)) {
    const source = asRecord(body[group]);
    if (source === undefined) continue;
    const picked: Record<string, number> = {};
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) picked[key] = value;
    }
    counts[group] = picked;
  }
  return `HTTP 200\n${JSON.stringify(counts)}`;
}

export async function main(env: Record<string, string | undefined> = process.env): Promise<number> {
  let request: TickRequest;
  try {
    request = buildTickRequest(env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : 'Configuração inválida');
    return 1;
  }
  try {
    const res = await fetch(request.url, request.init);
    console.log(formatTickOutput(res.status, await res.text()));
    return res.status === 200 ? 0 : 1;
  } catch {
    // Sem a mensagem do erro: URL de redirecionamento e segredo não devem aparecer.
    console.error('Falha ao chamar o agendador (a API está no ar? houve redirecionamento?)');
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
