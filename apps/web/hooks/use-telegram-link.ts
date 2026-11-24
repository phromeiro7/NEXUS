"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LinkCodeDto } from "@nexus/shared";
import { useApi } from "@/components/auth-provider";
import { queryKeys } from "@/hooks/queries";
import { messageFor } from "@/lib/messages";

/** Só links do próprio Telegram viram botão: qualquer outra coisa vinda da API é ignorada. */
const TELEGRAM_PREFIX = "https://t.me/";
/** Com o código válido, consulta as configurações nesse intervalo para perceber o vínculo feito no bot. */
const SETTINGS_POLL_MS = 5000;
/** Atualiza a contagem regressiva a cada segundo. */
const COUNTDOWN_TICK_MS = 1000;

/** Tempo restante em "m:ss" (ex.: 125000 ms → "2:05"); nunca negativo. */
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Estado e ações do vínculo do Telegram: gera o código, acompanha a validade (e consulta as configurações
 * enquanto o código vale, para perceber o vínculo) e desvincula. Sem marcação: o painel e o Mini App a desenham.
 */
export function useTelegramLink({ linked, paused }: { linked: boolean; paused: boolean }) {
  const api = useApi();
  const queryClient = useQueryClient();

  // Refs (e não estado) porque precisam valer na hora, sem esperar novo render: evitam atualizar
  // estado depois de desmontar e pedidos duplicados por duplo clique.
  const mounted = useRef(true);
  const generating = useRef(false);
  const unlinking = useRef(false);

  const [code, setCode] = useState<LinkCodeDto | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [unlinkPending, setUnlinkPending] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Vinculado e sem pausa (detectado pelo polling): o código não vale mais.
  // Vinculado e pausado ainda precisa de um código novo para retomar.
  const isLinkActive = linked && !paused;
  useEffect(() => {
    if (isLinkActive) {
      setCode(null);
      setExpired(false);
      setCopyMessage(null);
    }
  }, [isLinkActive]);

  const activeCode = isLinkActive ? null : code;
  const expiresAtMs = activeCode ? Date.parse(activeCode.expiresAt) : null;

  useEffect(() => {
    if (activeCode === null || expiresAtMs === null) return;
    setNow(Date.now());
    const countdownTimer = setInterval(() => {
      const currentTime = Date.now();
      if (currentTime >= expiresAtMs) {
        setCode(null);
        setExpired(true);
        setCopyMessage(null);
        return;
      }
      setNow(currentTime);
    }, COUNTDOWN_TICK_MS);
    // Invalidar as configurações faz `linked` mudar quando o bot confirmar o vínculo.
    const settingsPoll = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    }, SETTINGS_POLL_MS);
    return () => {
      clearInterval(countdownTimer);
      clearInterval(settingsPoll);
    };
  }, [activeCode, expiresAtMs, queryClient]);

  /** Gera um código novo de vínculo; ignora cliques enquanto um pedido já está em andamento. */
  async function generate() {
    if (generating.current) return;
    generating.current = true;
    setPending(true);
    setError(null);
    try {
      const newCode = await api.createLinkCode();
      if (!mounted.current) return;
      setCode(newCode);
      setExpired(false);
      setCopyMessage(null);
      setNow(Date.now());
    } catch (err) {
      if (mounted.current) setError(messageFor(err));
    } finally {
      generating.current = false;
      if (mounted.current) setPending(false);
    }
  }

  /** Copia o código ativo para a área de transferência e mostra o resultado em `copyMessage`. */
  async function copy() {
    if (activeCode === null) return;
    try {
      await navigator.clipboard.writeText(activeCode.code);
      if (mounted.current) setCopyMessage("Código copiado.");
    } catch {
      if (mounted.current) setCopyMessage("Não foi possível copiar.");
    }
  }

  /** Desvincula e atualiza as configurações; o erro fica em `error`. */
  async function unlink() {
    if (unlinking.current) return;
    unlinking.current = true;
    setUnlinkPending(true);
    setError(null);
    try {
      await api.unlinkTelegram();
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    } catch (err) {
      if (mounted.current) setError(messageFor(err));
    } finally {
      unlinking.current = false;
      if (mounted.current) setUnlinkPending(false);
    }
  }

  return {
    activeCode,
    remaining: expiresAtMs === null ? null : formatRemaining(expiresAtMs - now),
    expired,
    pending,
    error,
    clearError: () => setError(null),
    copyMessage,
    unlinkPending,
    hasClipboard: typeof navigator !== "undefined" && !!navigator.clipboard,
    link: activeCode && activeCode.deepLink.startsWith(TELEGRAM_PREFIX) ? activeCode.deepLink : null,
    generate,
    copy,
    unlink,
  };
}
