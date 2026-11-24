"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createQrLogin, pollQrLogin, type QrLoginFailure } from "@/lib/qr-login";

/** Etapas do login por QR, na ordem em que a tela as percorre (as quatro últimas encerram a espera). */
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
/** Primeira consulta logo depois de criar o pedido. */
const FIRST_POLL_DELAY_MS = 2_000;
/** Falhas de rede seguidas: espera cresce até 10 s; na terceira a tela mostra o erro com "Tentar de novo". */
const NETWORK_RETRIES = 3;
const NETWORK_BACKOFF_BASE_MS = 2_000;
const NETWORK_BACKOFF_MAX_MS = 10_000;
/** Espera quando a API limita as tentativas sem dizer por quanto tempo. */
const DEFAULT_RETRY_AFTER_SECONDS = 5;
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
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Callbacks em refs: o efeito usa sempre a versão mais recente sem reiniciar o login a cada render.
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
    let startedAt = 0;
    let consecutiveNetworkFailures = 0;
    let request: { id: string; pollSecret: string } | null = null;
    const controller = new AbortController();
    const fetchOverride = fetchRef.current ? { fetch: fetchRef.current } : {};

    const stopWith = (
      nextPhase: QrPhase,
      failure: QrLoginFailure | null = null,
      waitSeconds: number | null = null,
    ) => {
      setPhase(nextPhase);
      setError(failure);
      setRetryAfterSeconds(waitSeconds);
    };

    const scheduleNextPoll = (delayMs: number) => {
      if (!active) return;
      clearTimeout(timer);
      timer = setTimeout(() => void pollOnce(), delayMs);
    };

    async function pollOnce(): Promise<void> {
      if (!active || request === null) return;
      // Aba escondida: não consulta. Ao voltar, a consulta é imediata.
      if (typeof document !== "undefined" && document.hidden) {
        paused = true;
        return;
      }
      if (Date.now() - startedAt > GIVE_UP_MS) return stopWith("expired");
      const result = await pollQrLogin({
        apiBaseUrl,
        id: request.id,
        pollSecret: request.pollSecret,
        signal: controller.signal,
        ...fetchOverride,
      });
      if (!active) return;
      if (!result.ok) {
        if (result.code === "rede") {
          consecutiveNetworkFailures += 1;
          if (consecutiveNetworkFailures >= NETWORK_RETRIES) return stopWith("error", "rede");
          // Espera exponencial: 4 s, 8 s... limitada a 10 s.
          const backoffMs = NETWORK_BACKOFF_BASE_MS * 2 ** consecutiveNetworkFailures;
          return scheduleNextPoll(Math.min(backoffMs, NETWORK_BACKOFF_MAX_MS));
        }
        if (result.code === "muitas_tentativas") {
          const waitSeconds = Math.max(1, result.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS);
          return scheduleNextPoll(waitSeconds * 1_000);
        }
        // Pedido que já não existe (limpo depois de vencer) é o mesmo que expirado.
        if (result.code === "nao_encontrado") return stopWith("expired");
        return stopWith("error", result.code);
      }
      consecutiveNetworkFailures = 0;
      switch (result.status) {
        case "aguardando":
          setPhase("waiting");
          return scheduleNextPoll(pollDelay(Date.now() - startedAt));
        case "confirmar":
          setPhase("confirm");
          return scheduleNextPoll(pollDelay(Date.now() - startedAt));
        case "aprovado": {
          if (result.tokenHash === undefined) return stopWith("error", "generico");
          setPhase("entering");
          const exchanged = await exchangeRef.current(result.tokenHash);
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
        void pollOnce();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    void (async () => {
      stopWith("creating");
      setDeepLink(null);
      const created = await createQrLogin({ apiBaseUrl, signal: controller.signal, ...fetchOverride });
      if (!active) return;
      if (!created.ok) return stopWith("error", created.code, created.retryAfterSeconds ?? null);
      request = { id: created.request.id, pollSecret: created.request.pollSecret };
      startedAt = Date.now();
      setDeepLink(created.request.deepLink);
      setPhase("waiting");
      scheduleNextPoll(FIRST_POLL_DELAY_MS);
    })();

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, apiBaseUrl, attempt]);

  // Mudar `attempt` reinicia o efeito: descarta o pedido atual e cria outro.
  const restart = useCallback(() => setAttempt((previousAttempt) => previousAttempt + 1), []);
  return { phase, deepLink, error, retryAfterSeconds, restart };
}
