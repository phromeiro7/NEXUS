"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LinkCodeDto } from "@aj/shared";
import { useApi } from "@/components/auth-provider";
import { queryKeys } from "@/hooks/queries";
import { messageFor } from "@/lib/messages";
import { ConfirmDialog } from "./confirm-dialog";

const btn = "min-h-10 rounded border border-[var(--color-borda)] px-3 py-2 text-sm disabled:opacity-60";
const btnPrimary =
  "min-h-10 rounded bg-[var(--color-destaque)] px-3 py-2 text-sm font-medium text-[var(--color-superficie)] disabled:opacity-60";

const TELEGRAM_PREFIX = "https://t.me/";
const POLL_MS = 5000;
const TICK_MS = 1000;

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Vínculo do Telegram: gera o código, acompanha a validade e permite desvincular. */
export function TelegramLink({ linked, paused }: { linked: boolean; paused: boolean }) {
  const api = useApi();
  const client = useQueryClient();

  const mounted = useRef(true);
  const generating = useRef(false);
  const unlinking = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef<HTMLElement | null>(null);

  const [code, setCode] = useState<LinkCodeDto | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
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

  async function confirmUnlink() {
    if (unlinking.current) return;
    unlinking.current = true;
    setUnlinkPending(true);
    setError(null);
    try {
      await api.unlinkTelegram();
      await client.invalidateQueries({ queryKey: queryKeys.settings });
      // O botão Desvincular some com o vínculo; o foco volta ao contêiner, sempre montado.
      returnRef.current = rootRef.current;
    } catch (err) {
      if (mounted.current) setError(messageFor(err));
    } finally {
      unlinking.current = false;
      if (mounted.current) {
        setUnlinkPending(false);
        setConfirming(false);
      }
    }
  }

  const hasClipboard = typeof navigator !== "undefined" && !!navigator.clipboard;
  const link = activeCode && activeCode.deepLink.startsWith(TELEGRAM_PREFIX) ? activeCode.deepLink : null;

  return (
    <div ref={rootRef} tabIndex={-1} data-testid="telegram-link" className="flex flex-col gap-3 outline-none">
      {paused && (
        <p
          role="alert"
          className="rounded border-2 border-[var(--color-fatal)] p-3 text-sm font-semibold text-[var(--color-texto)]"
        >
          O envio está pausado (bot bloqueado). Gere um novo código para retomar.
        </p>
      )}

      {linked && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            <span aria-hidden="true">✓ </span>Telegram vinculado
          </p>
          <p className="text-sm">
            Responda a qualquer confirmação do bot para alterar aquela tarefa. Para parar de receber mensagens,
            desvincule.
          </p>
          <div>
            <button
              type="button"
              className={btn}
              disabled={unlinkPending}
              onClick={(e) => {
                returnRef.current = e.currentTarget;
                setError(null);
                setConfirming(true);
              }}
            >
              Desvincular
            </button>
          </div>
          <ConfirmDialog
            open={confirming}
            title="Desvincular o Telegram?"
            message="Você deixará de receber mensagens do bot e de responder a elas. Você pode vincular de novo depois."
            confirmLabel="Sim, desvincular"
            pending={unlinkPending}
            returnFocusRef={returnRef}
            onConfirm={() => void confirmUnlink()}
            onCancel={() => setConfirming(false)}
          />
        </div>
      )}

      {(!linked || paused) && (
        <div className="flex flex-col gap-2">
          {!linked && <p className="text-sm">Telegram não vinculado</p>}
          {activeCode === null ? (
            <div>
              <button type="button" className={btnPrimary} disabled={pending} onClick={() => void generate()}>
                Gerar código
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p
                aria-label={`Código de vínculo: ${activeCode.code.split("").join(" ")}`}
                className="select-all font-mono text-3xl font-bold tracking-widest"
              >
                {activeCode.code}
              </p>
              {link !== null && (
                <p className="text-sm">
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-[var(--color-destaque)] underline"
                  >
                    Abrir no Telegram
                  </a>
                </p>
              )}
              <p className="text-sm">Se preferir, envie ao bot: /start {activeCode.code}</p>
              <p aria-hidden="true" className="text-sm font-medium">
                Válido por {formatRemaining(expiresAtMs! - now)}
              </p>
              <p className="text-sm text-[var(--color-texto-suave)]">
                O código vale por 10 minutos e só pode ser usado uma vez.
              </p>
              <div className="flex flex-wrap gap-2">
                {hasClipboard && (
                  <button type="button" className={btn} onClick={() => void copy()}>
                    Copiar código
                  </button>
                )}
                <button type="button" className={btn} disabled={pending} onClick={() => void generate()}>
                  Gerar outro código
                </button>
              </div>
            </div>
          )}
          {expired && activeCode === null && (
            <p role="status" className="text-sm font-medium">
              O código expirou. Gere outro.
            </p>
          )}
        </div>
      )}

      {/* Feedback de cópia (anunciado como status). */}
      {copyMsg !== null && (
        <p role="status" className="text-sm">
          {copyMsg}
        </p>
      )}

      {error !== null && (
        <p role="alert" className="text-sm text-[var(--color-fatal)]">
          {error}
        </p>
      )}
    </div>
  );
}
