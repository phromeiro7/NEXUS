"use client";

import { useState } from "react";
import { useTelegramLink } from "@/hooks/use-telegram-link";

/** Vínculo do Telegram no Mini App: mesma lógica do painel (`useTelegramLink`), com a cara do Mini App. */
export function TelegramCard({ linked, paused }: { linked: boolean; paused: boolean }) {
  const t = useTelegramLink({ linked, paused });
  const { activeCode, expired, pending, error, copyMsg, unlinkPending, hasClipboard, link } = t;
  const [confirming, setConfirming] = useState(false);

  async function confirmUnlink() {
    await t.unlink();
    setConfirming(false);
  }

  return (
    <section className="mini-card mini-tg" aria-labelledby="mini-tg-title" data-testid="telegram-card">
      <h2 id="mini-tg-title" className="mini-tg-title">
        Telegram
      </h2>

      {paused && (
        <p role="alert" className="mini-alert">
          O envio está pausado (bot bloqueado). Gere um novo código para retomar.
        </p>
      )}

      {linked && (
        <div className="mini-tg-block">
          <p className="mini-tg-state">Telegram vinculado</p>
          <p className="mini-tg-text">
            Responda a qualquer confirmação do bot para alterar aquela tarefa. Para parar de receber mensagens,
            desvincule.
          </p>
          {confirming ? (
            <div role="group" aria-label="Desvincular o Telegram?" className="mini-tg-block">
              <p className="mini-tg-text">
                Você deixará de receber mensagens do bot e de responder a elas. Você pode vincular de novo depois.
              </p>
              <div className="mini-tg-actions">
                <button type="button" className="mini-btn danger" disabled={unlinkPending} onClick={() => void confirmUnlink()}>
                  {unlinkPending ? "Desvinculando…" : "Sim, desvincular"}
                </button>
                <button type="button" className="mini-btn" disabled={unlinkPending} onClick={() => setConfirming(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="mini-tg-actions">
              <button
                type="button"
                className="mini-btn"
                onClick={() => {
                  t.clearError();
                  setConfirming(true);
                }}
              >
                Desvincular
              </button>
            </div>
          )}
        </div>
      )}

      {(!linked || paused) && (
        <div className="mini-tg-block">
          {!linked && <p className="mini-tg-text">Ainda não conectado. Vincule para receber os lembretes no chat.</p>}
          {activeCode === null ? (
            <button type="button" className="mini-btn primary" disabled={pending} onClick={() => void t.generate()}>
              {pending ? "Gerando…" : "Gerar código"}
            </button>
          ) : (
            <>
              <p aria-label={`Código de vínculo: ${activeCode.code.split("").join(" ")}`} className="mini-code">
                {activeCode.code}
              </p>
              {link !== null && (
                <a href={link} target="_blank" rel="noopener noreferrer" className="mini-btn primary">
                  Abrir no Telegram
                </a>
              )}
              <p className="mini-tg-text">Se preferir, envie ao bot: /start {activeCode.code}</p>
              <p aria-hidden="true" className="mini-tg-text">
                Válido por {t.remaining}. Só pode ser usado uma vez.
              </p>
              <div className="mini-tg-actions">
                {hasClipboard && (
                  <button type="button" className="mini-btn" onClick={() => void t.copy()}>
                    Copiar código
                  </button>
                )}
                <button type="button" className="mini-btn" disabled={pending} onClick={() => void t.generate()}>
                  Gerar outro código
                </button>
              </div>
            </>
          )}
          {expired && activeCode === null && (
            <p role="status" className="mini-tg-text">
              O código expirou. Gere outro.
            </p>
          )}
        </div>
      )}

      {copyMsg !== null && (
        <p role="status" className="mini-tg-text">
          {copyMsg}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="mini-fielderr">
          {error}
        </p>
      )}
    </section>
  );
}
