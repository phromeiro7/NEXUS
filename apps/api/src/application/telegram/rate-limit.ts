import type { Clock } from '../ports.js';

export type RateLimiter = {
  /** Conta uma tentativa para `key`; `null` se ainda cabe, senão os segundos até liberar. */
  hit(key: string): number | null;
};

/**
 * Limite de janela fixa, em memória. Vale por instância da API (suficiente para um processo só;
 * com várias instâncias o limite efetivo é multiplicado). As chaves vencidas são varridas aos poucos.
 */
/** Acima disto, cada tentativa varre as janelas vencidas (evita crescimento sem fim do mapa). */
const SWEEP_THRESHOLD_KEYS = 5000;
const MS_PER_SECOND = 1000;

export function makeRateLimiter(opts: { max: number; windowMs: number; clock: Clock }): RateLimiter {
  const { max, windowMs, clock } = opts;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key) {
      const nowMs = clock.now().getTime();
      if (windows.size > SWEEP_THRESHOLD_KEYS) {
        for (const [windowKey, existing] of windows) if (nowMs - existing.start >= windowMs) windows.delete(windowKey);
      }
      const current = windows.get(key);
      if (current === undefined || nowMs - current.start >= windowMs) {
        windows.set(key, { start: nowMs, count: 1 });
        return null;
      }
      current.count += 1;
      if (current.count <= max) return null;
      return Math.max(1, Math.ceil((current.start + windowMs - nowMs) / MS_PER_SECOND));
    },
  };
}
