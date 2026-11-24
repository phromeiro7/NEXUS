/** Limita falhas de `/start CÓDIGO` por chat, para que não dê para adivinhar códigos por força bruta. */
export type FailedStartLimiter = {
  allow(chatId: number, now: Date): boolean;
  recordFailure(chatId: number, now: Date): void;
};

const DEFAULT_MAX_TRACKED_CHATS = 10_000;

/**
 * Janela deslizante por chat, em memória (por instância): no máximo `max` falhas de `/start CÓDIGO`
 * dentro de `windowMs`. Entradas vencidas são podadas e o número de chats rastreados é limitado,
 * então a memória não cresce sem fim. O relógio vem pelo argumento `now`.
 */
export function createFailedStartLimiter(opts: { max: number; windowMs: number; maxChats?: number }) {
  const { max, windowMs } = opts;
  const maxChats = opts.maxChats ?? DEFAULT_MAX_TRACKED_CHATS;
  const failures = new Map<number, number[]>();
  let lastSweepMs = Number.NEGATIVE_INFINITY;

  /** Falhas ainda dentro da janela. */
  const withinWindow = (failureTimes: number[], nowMs: number) =>
    failureTimes.filter((failureMs) => nowMs - failureMs < windowMs);

  /** Remove falhas vencidas e chats sem falha recente. */
  function sweepExpired(nowMs: number): void {
    lastSweepMs = nowMs;
    for (const [chatId, failureTimes] of failures) {
      const kept = withinWindow(failureTimes, nowMs);
      if (kept.length === 0) failures.delete(chatId);
      else failures.set(chatId, kept);
    }
  }

  return {
    allow(chatId: number, now: Date): boolean {
      const failureTimes = failures.get(chatId);
      if (failureTimes === undefined) return true;
      return withinWindow(failureTimes, now.getTime()).length < max;
    },

    recordFailure(chatId: number, now: Date): void {
      const nowMs = now.getTime();
      if (nowMs - lastSweepMs >= windowMs || failures.size >= maxChats) sweepExpired(nowMs);
      // Ainda cheio depois da poda: descarta o chat mais antigo (ordem de inserção do Map).
      while (failures.size >= maxChats && !failures.has(chatId)) {
        const oldestChatId = failures.keys().next().value;
        if (oldestChatId === undefined) break;
        failures.delete(oldestChatId);
      }
      // Só as `max` falhas mais recentes importam para a contagem.
      const kept = [...withinWindow(failures.get(chatId) ?? [], nowMs), nowMs].slice(-max);
      // Apaga e regrava para o chat ir para o fim da ordem de inserção (mais recente).
      failures.delete(chatId);
      failures.set(chatId, kept);
    },

    /** Chats rastreados (para testes). */
    size(): number {
      return failures.size;
    },
  };
}
