"use client";

import { useId, useState, type ReactNode } from "react";
import type { QrLoginState } from "@/hooks/use-qr-login";
import { QrCode } from "./qr-code";
import { NexusMark } from "./mini/icons";

/** O que dizer em cada estado. `title` é o que importa; `text`, o apoio. */
function describeQrLoginState(state: QrLoginState): { title: string; text: string } {
  switch (state.phase) {
    case "creating":
      return { title: "Preparando o código…", text: "Só um instante." };
    case "waiting":
      return { title: "Aguardando você ler o código.", text: "Ele vale por 3 minutos." };
    case "confirm":
      return { title: "Confirme no celular.", text: "O bot está esperando a sua resposta." };
    case "entering":
      return { title: "Entrando…", text: "Seu painel está abrindo." };
    case "expired":
      return { title: "O código expirou.", text: "Por segurança, ele vale só 3 minutos." };
    case "denied":
      return { title: "Ninguém entrou.", text: "Você tocou em “Não fui eu”, então o acesso foi negado." };
    case "refused":
      return {
        title: "Este Telegram ainda não tem acesso ao Nexus.",
        text: "Peça um convite a quem lhe indicou o Nexus.",
      };
    case "error":
      switch (state.error) {
        case "rede":
          return { title: "Sem conexão.", text: "Verifique sua internet e tente de novo." };
        case "muitas_tentativas":
          return { title: "Muitas tentativas.", text: "Aguarde alguns minutos e tente de novo." };
        case "login_desabilitado":
          return { title: "A entrada pelo Telegram não está disponível agora.", text: "Use e-mail e senha." };
        default:
          return { title: "Não foi possível entrar.", text: "Gere um novo código e tente de novo." };
      }
  }
}

/** Selo sobre o QR nas fases em que ele não vale mais (ou já foi usado). */
const OVERLAY_LABELS: Partial<Record<QrLoginState["phase"], string>> = {
  expired: "Código expirado",
  denied: "Acesso negado",
  refused: "Sem acesso",
  entering: "Entrando…",
};

/**
 * Tela de entrada do painel: QR code, passos e, como alternativa discreta, e-mail e senha. Só desenha o estado
 * que recebe (a espera pelo servidor está em `useQrLogin`). Em tela estreita (o celular) o QR não aparece: ler
 * o código com o mesmo aparelho não faz sentido; o botão "Abrir no Telegram" faz o papel dele.
 */
export function QrLoginScreen({ state, emailForm, note }: { state: QrLoginState; emailForm: ReactNode; note?: ReactNode }) {
  const emailSectionId = useId();
  const { phase, deepLink, error } = state;
  const telegramLoginDisabled = phase === "error" && error === "login_desabilitado";
  const [emailToggledOpen, setEmailToggledOpen] = useState(false);
  // Sem o login por Telegram, o e-mail é o único caminho: já aberto.
  const emailOpen = emailToggledOpen || telegramLoginDisabled;
  const { title, text } = describeQrLoginState(state);
  const retryLabel = phase === "expired" ? "Gerar novo código" : "Tentar de novo";
  const showRetry =
    phase === "expired" || phase === "denied" || phase === "refused" || (phase === "error" && !telegramLoginDisabled);
  const isCodeActive = phase === "waiting" || phase === "confirm";
  const showOpenInTelegram = deepLink !== null && isCodeActive;
  const dimmed = !isCodeActive;
  const overlayLabel = OVERLAY_LABELS[phase];

  return (
    <div className="mini nx-auth">
      <main className="nx-main nx-wide">
        <div className="nx-brand">
          <NexusMark size={44} />
          <b>nexus</b>
        </div>
        <div className="nx-qr-grid">
          <section className="nx-qr-intro" aria-labelledby="nx-qr-title">
            <h1 id="nx-qr-title">Entrar no Nexus</h1>
            <p className="nx-qr-lead">Sem senha. Sua conta é a mesma do Telegram, e o celular confirma que é você.</p>
            {note}
            <ol className="nx-steps nx-wide-only">
              <li>Abra o Telegram no celular.</li>
              <li>
                Aponte a câmera para o código, ou use o botão <b>Abrir no Telegram</b>.
              </li>
              <li>
                Toque em <b>Confirmar</b> quando o bot perguntar.
              </li>
            </ol>
            <ol className="nx-steps nx-narrow-only">
              <li>
                Toque em <b>Abrir no Telegram</b>.
              </li>
              <li>
                Toque em <b>Confirmar</b> quando o bot perguntar.
              </li>
              <li>Volte para esta página: ela entra sozinha.</li>
            </ol>
          </section>

          <section className="nx-qr-box" aria-label="Código de acesso">
            <div className="nx-qr-card nx-wide-only">
              {deepLink !== null ? (
                <QrCode value={deepLink} label="Código QR para entrar no Nexus pelo Telegram" dimmed={dimmed} />
              ) : (
                <div className="nx-qr-placeholder" aria-hidden="true" />
              )}
              {overlayLabel !== undefined && (
                <div className="nx-qr-overlay" aria-hidden="true">
                  <span>{overlayLabel}</span>
                </div>
              )}
            </div>

            <p className="nx-qr-status" role="status" aria-live="polite">
              <b>{title}</b> <span>{text}</span>
            </p>

            <div className="nx-qr-actions">
              {showOpenInTelegram && (
                <a className="mini-btn primary" href={deepLink} target="_blank" rel="noopener noreferrer">
                  Abrir no Telegram
                </a>
              )}
              {showRetry && (
                <button type="button" className="mini-btn primary" onClick={state.restart}>
                  {retryLabel}
                </button>
              )}
            </div>
          </section>
        </div>

        <section className="nx-mail" aria-label="Entrar com e-mail">
          {!telegramLoginDisabled && (
            <button
              type="button"
              className="nx-link nx-mail-toggle"
              aria-expanded={emailOpen}
              aria-controls={emailSectionId}
              onClick={() => setEmailToggledOpen((open) => !open)}
            >
              {emailOpen ? "Voltar para o código" : "Entrar com e-mail e senha"}
            </button>
          )}
          <div id={emailSectionId} className="nx-card nx-mail-card" hidden={!emailOpen}>
            {emailOpen && emailForm}
          </div>
        </section>
      </main>
    </div>
  );
}
