"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createQrLogin, pollQrLogin, type QrLoginFailure } from "@/lib/qr-login";

export type QrPhase = "creating" | "waiting" | "confirm" | "entering" | "denied" | "refused" | "expired" | "error";

export type QrLoginState = {
  phase: QrPhase;
  /** Link do bot para o QR e o botão "Abrir no Telegram"; nulo antes de o pedido existir. */
  deepLink: string | null;
  /** Motivo, só com `phase === "error"`. */
  error: QrLoginFailure | null;
  /** Segundos de espera pedidos pela API (limite de tentativas). */
  retryAfterSeconds: number | null;
  /** Descarta o pedido atual e cria outro. */
  restart(): void;
};

type Options = {
  /** Falso = não cria pedido nenhum (ex.: dentro do Telegram, onde o login é automático). */
  enabled: boolean;
  apiBaseUrl: string;
  /** Troca o token de uso único por sessão (`verifyOtp`). */
  exchangeToken(tokenHash: string): Promise<{ error: string | null }>;
  /** Chamado uma vez, depois que a sessão abriu. */
  onSignedIn(): void;
  fetch?: typeof fetch;
};

/** Leve no começo, mais devagar quanto mais espera: ninguém precisa de resposta a cada 2 s depois de 1 minuto. */
function pollDelay(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 2_000;
  if (elapsedMs < 90_000) return 3_000;
  return 5_000;
}
/** Falhas de rede seguidas: espera cresce até 10 s; na terceira a tela mostra o erro com "Tentar de novo". */
const NETWORK_RETRIES = 3;
/** Rede de segurança caso o servidor nunca diga "expirado" (o pedido vale 3 minutos). */
const GIVE_UP_MS = 10 * 60_000;

/**
 * Login por QR code. Cria o pedido, consulta o estado sem parar quando a aba está escondida e leva a pessoa da
 * espera até a sessão. O `pollSecret` vive só numa variável deste efeito: nunca em estado, armazenamento nem URL.
 */
export function useQrLogin(options: Options): QrLoginState {
  const { enabled, apiBaseUrl } = options;
  const [phase, setPhase] = useState<QrPhase>("creating");
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [error, setError] = useState<QrLoginFailure | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);

  const exchangeRef = useRef(options.exchangeToken);
  exchangeRef.current = options.exchangeToken;
  const signedInRef = useRef(options.onSignedIn);
  signedInRef.current = options.onSignedIn;
  const fetchRef = useRef(options.fetch);
  fetchRef.current = options.fetch;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let paused = false;
    let started = 0;
    let failures = 0;
    let request: { id: string; pollSecret: string } | null = null;
    const controller = new AbortController();
    const fetchOpt = fetchRef.current ? { fetch: fetchRef.current } : {};

    const stopWith = (next: QrPhase, why: QrLoginFailure | null = null, wait: number | null = null) => {
      setPhase(next);
      setError(why);
      setRetryAfter(wait);
    };

    const schedule = (ms: number) => {
      if (!active) return;
      clearTimeout(timer);
      timer = setTimeout(() => void tick(), ms);
    };

    async function tick(): Promise<void> {
      if (!active || request === null) return;
      // Aba escondida: não consulta. Ao voltar, a consulta é imediata.
      if (typeof document !== "undefined" && document.hidden) {
        paused = true;
        return;
      }
      if (Date.now() - started > GIVE_UP_MS) return stopWith("expired");
      const res = await pollQrLogin({ apiBaseUrl, id: request.id, pollSecret: request.pollSecret, signal: controller.signal, ...fetchOpt });
      if (!active) return;
      if (!res.ok) {
        if (res.code === "rede") {
          failures += 1;
          if (failures >= NETWORK_RETRIES) return stopWith("error", "rede");
          return schedule(Math.min(2_000 * 2 ** failures, 10_000));
        }
        if (res.code === "muitas_tentativas") return schedule(Math.max(1, res.retryAfterSeconds ?? 5) * 1_000);
        // Pedido que já não existe (limpo depois de vencer) é o mesmo que expirado.
        if (res.code === "nao_encontrado") return stopWith("expired");
        return stopWith("error", res.code);
      }
      failures = 0;
      switch (res.status) {
        case "aguardando":
          setPhase("waiting");
          return schedule(pollDelay(Date.now() - started));
        case "confirmar":
          setPhase("confirm");
          return schedule(pollDelay(Date.now() - started));
        case "aprovado": {
          if (res.tokenHash === undefined) return stopWith("error", "generico");
          setPhase("entering");
          const exchanged = await exchangeRef.current(res.tokenHash);
          if (!active) return;
          if (exchanged.error !== null) return stopWith("error", "generico");
          signedInRef.current();
          return;
        }
        case "negado":
          return stopWith("denied");
        case "recusado":
          return stopWith("refused");
        case "expirado":
          return stopWith("expired");
      }
    }

    const onVisible = () => {
      if (!document.hidden && paused && active) {
        paused = false;
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    void (async () => {
      stopWith("creating");
      setDeepLink(null);
      const created = await createQrLogin({ apiBaseUrl, signal: controller.signal, ...fetchOpt });
      if (!active) return;
      if (!created.ok) return stopWith("error", created.code, created.retryAfterSeconds ?? null);
      request = { id: created.request.id, pollSecret: created.request.pollSecret };
      started = Date.now();
      setDeepLink(created.request.deepLink);
      setPhase("waiting");
      schedule(2_000);
    })();

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, apiBaseUrl, attempt]);

  const restart = useCallback(() => setAttempt((n) => n + 1), []);
  return { phase, deepLink, error, retryAfterSeconds: retryAfter, restart };
}
