export type FailedStartLimiter = {
  allow(chatId: number, now: Date): boolean;
  recordFailure(chatId: number, now: Date): void;
};

/**
 * Janela deslizante por chat, em memória (por instância): no máximo `max` falhas de `/start CÓDIGO`
 * dentro de `windowMs`. Entradas vencidas são podadas e o número de chats rastreados é limitado,
 * então a memória não cresce sem fim. O relógio vem pelo argumento `now`.
 */
export function createFailedStartLimiter(opts: { max: number; windowMs: number; maxChats?: number }) {
  const { max, windowMs } = opts;
  const maxChats = opts.maxChats ?? 10_000;
  const failures = new Map<number, number[]>();
  let lastSweep = Number.NEGATIVE_INFINITY;

  const live = (times: number[], nowMs: number) => times.filter((t) => nowMs - t < windowMs);

  function sweep(nowMs: number): void {
    lastSweep = nowMs;
    for (const [chatId, times] of failures) {
      const kept = live(times, nowMs);
      if (kept.length === 0) failures.delete(chatId);
      else failures.set(chatId, kept);
    }
  }

  return {
    allow(chatId: number, now: Date): boolean {
      const times = failures.get(chatId);
      if (times === undefined) return true;
      return live(times, now.getTime()).length < max;
    },

    recordFailure(chatId: number, now: Date): void {
      const nowMs = now.getTime();
      if (nowMs - lastSweep >= windowMs || failures.size >= maxChats) sweep(nowMs);
      // Ainda cheio depois da poda: descarta o chat mais antigo (ordem de inserção do Map).
      while (failures.size >= maxChats && !failures.has(chatId)) {
        const oldest = failures.keys().next().value;
        if (oldest === undefined) break;
        failures.delete(oldest);
      }
      // Só as `max` falhas mais recentes importam para a contagem.
      const kept = [...live(failures.get(chatId) ?? [], nowMs), nowMs].slice(-max);
      failures.delete(chatId);
      failures.set(chatId, kept);
    },

    /** Chats rastreados (para testes). */
    size(): number {
      return failures.size;
    },
  };
}
