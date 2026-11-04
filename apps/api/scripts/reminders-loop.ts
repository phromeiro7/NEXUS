/*
 * Agendador local provisório: repete `reminders:tick` a cada INTERVALO (60 s por padrão) até receber
 * SIGINT/SIGTERM. Em produção quem chama a rota é o pg_cron (README, "Telegram e lembretes: runbook").
 * Variáveis: as do tick (INTERNAL_SECRET, REMINDERS_URL) e REMINDERS_LOOP_SECONDS (5 a 3600).
 * Uma passada que falha (API fora do ar, rede) vira uma linha de log e o laço segue; nada do corpo da
 * resposta, do segredo nem de mensagens de erro é impresso: o tick já filtra a saída.
 */
import { pathToFileURL } from 'node:url';
import { main as tickOnce } from './reminders-tick.js';

export const DEFAULT_INTERVAL_SECONDS = 60;

/** Lê REMINDERS_LOOP_SECONDS; vazio = padrão; fora de 5..3600 ou não inteiro lança (nomeia a variável). */
export function loopIntervalMs(env: Record<string, string | undefined>): number {
  const raw = env.REMINDERS_LOOP_SECONDS?.trim();
  if (raw === undefined || raw === '') return DEFAULT_INTERVAL_SECONDS * 1000;
  const seconds = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 3600) {
    throw new Error('REMINDERS_LOOP_SECONDS inválida: esperado um inteiro entre 5 e 3600');
  }
  return seconds * 1000;
}

export type LoopDeps = {
  /** Uma passada; devolve o código de saída do tick (0 = ok). Nunca deve lançar, mas se lançar o laço segue. */
  tick: () => Promise<number>;
  /** Espera `ms`; resolve `false` se o laço foi interrompido durante a espera. */
  sleep: (ms: number) => Promise<boolean>;
  intervalMs: number;
  log: (line: string) => void;
  now?: () => Date;
};

/** Roda passadas até `sleep` devolver `false`. Devolve quantas passadas foram feitas. */
export async function runLoop(deps: LoopDeps): Promise<number> {
  const now = deps.now ?? (() => new Date());
  let passes = 0;
  for (;;) {
    let code: number;
    try {
      code = await deps.tick();
    } catch {
      code = 1;
    }
    passes += 1;
    deps.log(`${now().toISOString()} tick ${code === 0 ? 'ok' : 'falhou'}`);
    if (!(await deps.sleep(deps.intervalMs))) return passes;
  }
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
  let intervalMs: number;
  try {
    intervalMs = loopIntervalMs(env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : 'Configuração inválida');
    return 1;
  }
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => controller.abort());
  console.log(`Agendador local: uma passada a cada ${intervalMs / 1000} s (Ctrl+C para parar)`);
  await runLoop({
    tick: () => tickOnce(env),
    sleep: abortableSleep(controller.signal),
    intervalMs,
    log: (line) => console.log(line),
  });
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
