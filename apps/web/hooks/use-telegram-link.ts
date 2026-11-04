"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LinkCodeDto } from "@aj/shared";
import { useApi } from "@/components/auth-provider";
import { queryKeys } from "@/hooks/queries";
import { messageFor } from "@/lib/messages";

const TELEGRAM_PREFIX = "https://t.me/";
const POLL_MS = 5000;
const TICK_MS = 1000;

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Estado e ações do vínculo do Telegram: gera o código, acompanha a validade (e consulta as configurações
 * enquanto o código vale, para perceber o vínculo) e desvincula. Sem marcação: o painel e o Mini App a desenham.
 */
export function useTelegramLink({ linked, paused }: { linked: boolean; paused: boolean }) {
  const api = useApi();
  const client = useQueryClient();

  const mounted = useRef(true);
  const generating = useRef(false);
  const unlinking = useRef(false);

  const [code, setCode] = useState<LinkCodeDto | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [unlinkPending, setUnlinkPending] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Vinculado e sem pausa (detectado pelo polling): o código não vale mais.
  // Vinculado e pausado ainda precisa de um código novo para retomar.
  const settled = linked && !paused;
  useEffect(() => {
    if (settled) {
      setCode(null);
      setExpired(false);
      setCopyMsg(null);
    }
  }, [settled]);

  const activeCode = settled ? null : code;
  const expiresAtMs = activeCode ? Date.parse(activeCode.expiresAt) : null;

  useEffect(() => {
    if (activeCode === null || expiresAtMs === null) return;
    setNow(Date.now());
    const tick = setInterval(() => {
      const t = Date.now();
      if (t >= expiresAtMs) {
        setCode(null);
        setExpired(true);
        setCopyMsg(null);
        return;
      }
      setNow(t);
    }, TICK_MS);
    const poll = setInterval(() => {
      void client.invalidateQueries({ queryKey: queryKeys.settings });
    }, POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [activeCode, expiresAtMs, client]);

  async function generate() {
    if (generating.current) return;
    generating.current = true;
    setPending(true);
    setError(null);
    try {
      const next = await api.createLinkCode();
      if (!mounted.current) return;
      setCode(next);
      setExpired(false);
      setCopyMsg(null);
      setNow(Date.now());
    } catch (err) {
      if (mounted.current) setError(messageFor(err));
    } finally {
      generating.current = false;
      if (mounted.current) setPending(false);
    }
  }

  async function copy() {
    if (activeCode === null) return;
    try {
      await navigator.clipboard.writeText(activeCode.code);
      if (mounted.current) setCopyMsg("Código copiado.");
    } catch {
      if (mounted.current) setCopyMsg("Não foi possível copiar.");
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
      await client.invalidateQueries({ queryKey: queryKeys.settings });
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
    copyMsg,
    unlinkPending,
    hasClipboard: typeof navigator !== "undefined" && !!navigator.clipboard,
    link: activeCode && activeCode.deepLink.startsWith(TELEGRAM_PREFIX) ? activeCode.deepLink : null,
    generate,
    copy,
    unlink,
  };
}
