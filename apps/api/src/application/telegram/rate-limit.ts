import type { Clock } from '../ports.js';

export type RateLimiter = {
  /** Conta uma tentativa para `key`; `null` se ainda cabe, senão os segundos até liberar. */
  hit(key: string): number | null;
};

/**
 * Limite de janela fixa, em memória. Vale por instância da API (suficiente para um processo só;
 * com várias instâncias o limite efetivo é multiplicado). As chaves vencidas são varridas aos poucos.
 */
export function makeRateLimiter(opts: { max: number; windowMs: number; clock: Clock }): RateLimiter {
  const { max, windowMs, clock } = opts;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key) {
      const now = clock.now().getTime();
      if (windows.size > 5000) {
        for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
      }
      const w = windows.get(key);
      if (w === undefined || now - w.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        return null;
      }
      w.count += 1;
      if (w.count <= max) return null;
      return Math.max(1, Math.ceil((w.start + windowMs - now) / 1000));
    },
  };
}
