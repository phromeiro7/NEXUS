"use client";

import { useRef, useState } from "react";
import { useTelegramLink } from "@/hooks/use-telegram-link";
import { ConfirmDialog } from "./confirm-dialog";

const btn = "min-h-10 rounded border border-[var(--color-borda)] px-3 py-2 text-sm disabled:opacity-60";
const btnPrimary =
  "min-h-10 rounded bg-[var(--color-destaque)] px-3 py-2 text-sm font-medium text-[var(--color-superficie)] disabled:opacity-60";

/** Vínculo do Telegram: gera o código, acompanha a validade e permite desvincular. */
export function TelegramLink({ linked, paused }: { linked: boolean; paused: boolean }) {
  const t = useTelegramLink({ linked, paused });
  const { activeCode, expired, pending, error, copyMsg, unlinkPending, hasClipboard, link } = t;

  const rootRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function confirmUnlink() {
    await t.unlink();
    // O botão Desvincular some com o vínculo; o foco volta ao contêiner, sempre montado.
    returnRef.current = rootRef.current;
    setConfirming(false);
  }

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
                t.clearError();
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
              <button type="button" className={btnPrimary} disabled={pending} onClick={() => void t.generate()}>
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
                Válido por {t.remaining}
              </p>
              <p className="text-sm text-[var(--color-texto-suave)]">
                O código vale por 10 minutos e só pode ser usado uma vez.
              </p>
              <div className="flex flex-wrap gap-2">
                {hasClipboard && (
                  <button type="button" className={btn} onClick={() => void t.copy()}>
                    Copiar código
                  </button>
                )}
                <button type="button" className={btn} disabled={pending} onClick={() => void t.generate()}>
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
