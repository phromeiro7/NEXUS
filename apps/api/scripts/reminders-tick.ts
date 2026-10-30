/*
 * Dispara uma passada do agendador local: POST /internal/reminders/run com o segredo do ambiente.
 * Variáveis: INTERNAL_SECRET (obrigatória) e REMINDERS_URL (padrão http://localhost:3001).
 * Imprime só o status HTTP e as contagens; nunca o segredo.
 */
import { pathToFileURL } from 'node:url';

export type TickRequest = { url: string; init: { method: 'POST'; headers: Record<string, string> } };

/** Lê o ambiente; o erro nomeia a variável e nunca inclui valores. */
export function buildTickRequest(env: Record<string, string | undefined>): TickRequest {
  const secret = env.INTERNAL_SECRET?.trim();
  if (!secret) throw new Error('Variável de ambiente ausente: INTERNAL_SECRET');
  const base = (env.REMINDERS_URL?.trim() || 'http://localhost:3001').replace(/\/+$/, '');
  return {
    url: `${base}/internal/reminders/run`,
    init: { method: 'POST', headers: { 'X-Internal-Secret': secret } },
  };
}

/** Só o status e as contagens (JSON); um corpo que não é JSON não é repassado. */
export function formatTickOutput(status: number, bodyText: string): string {
  let counts = 'null';
  try {
    counts = JSON.stringify(JSON.parse(bodyText));
  } catch {
    counts = '(sem JSON)';
  }
  return `HTTP ${status}\n${counts}`;
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
    // Sem a mensagem do erro: a URL/segredo não devem aparecer.
    console.error('Falha ao chamar o agendador (a API está no ar?)');
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
