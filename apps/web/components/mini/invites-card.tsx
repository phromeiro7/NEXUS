"use client";

import { useState } from "react";
import type { InviteDto, InviteSummaryDto } from "@nexus/shared";
import { isForbidden, useCreateInvite, useInvites, useDeleteInvite } from "@/hooks/use-invites";
import { MS_PER_DAY } from "@/lib/dates";
import { messageFor } from "@/lib/messages";
import { OUTSIDE_TELEGRAM_PLATFORM } from "@/lib/telegram-init";

const SHARE_TEXT = "Entre no Nexus, meu assistente de tarefas e lembretes:";
/** Limite do apelido opcional do convite. */
const INVITE_LABEL_MAX_LENGTH = 60;

/** "dd/mm" de um instante ISO, no fuso do aparelho. */
const formatDayMonth = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

/** "12 gerados: 2 ativos, 9 usados, 1 expirado". Zeros ficam de fora. */
export function summaryText(summary: InviteSummaryDto): string {
  const parts = [
    [summary.ativos, "ativo", "ativos"],
    [summary.usados, "usado", "usados"],
    [summary.expirados, "expirado", "expirados"],
    [summary.revogados, "revogado", "revogados"],
  ]
    .filter(([count]) => (count as number) > 0)
    .map(([count, singular, plural]) => `${count} ${count === 1 ? singular : plural}`);
  const total = `${summary.total} ${summary.total === 1 ? "convite gerado" : "convites gerados"}`;
  return parts.length === 0 ? total : `${total}: ${parts.join(", ")}`;
}

/** O que apagar causa, dito antes de confirmar. Só convite usado tira o acesso de alguém. */
export function deleteWarning(invite: InviteDto): string {
  return invite.status === "usado"
    ? "Apagar este convite? A pessoa que entrou por ele perde o acesso ao Nexus agora."
    : "Apagar este convite? O link deixa de funcionar.";
}

/** Dias de validade do convite (da criação à expiração), arredondado e no mínimo 1. */
export function validityDays(invite: InviteDto): number {
  return Math.max(1, Math.round((Date.parse(invite.expiresAt) - Date.parse(invite.createdAt)) / MS_PER_DAY));
}

/** Estado do convite em uma frase para a lista: ativo até quando, usado ou expirado em que dia, ou revogado. */
export function statusLabel(invite: InviteDto): string {
  if (invite.status === "ativo") return `Ativo, vale até ${formatDayMonth(invite.expiresAt)}`;
  if (invite.status === "usado") return `Usado em ${invite.usedAt === null ? "—" : formatDayMonth(invite.usedAt)}`;
  if (invite.status === "expirado") return `Expirou em ${formatDayMonth(invite.expiresAt)}`;
  return "Revogado";
}

/**
 * Dentro do Telegram abre a tela de compartilhar dele; fora, usa o compartilhamento do aparelho e, sem ele,
 * copia o link. Devolve o que aconteceu, para avisar a pessoa.
 */
export async function shareInvite(invite: InviteDto): Promise<"compartilhado" | "copiado" | "falhou" | "cancelado"> {
  const webApp = typeof window === "undefined" ? undefined : window.Telegram?.WebApp;
  if (webApp?.openTelegramLink && webApp.platform !== OUTSIDE_TELEGRAM_PLATFORM) {
    webApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(invite.link)}&text=${encodeURIComponent(SHARE_TEXT)}`);
    return "compartilhado";
  }
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Nexus", text: SHARE_TEXT, url: invite.link });
      return "compartilhado";
    } catch (error) {
      // A pessoa fechou a folha de compartilhar: não é erro. Outras falhas caem na cópia do link.
      if (error instanceof DOMException && error.name === "AbortError") return "cancelado";
    }
  }
  return copyLink(invite);
}

/** Copia o link do convite para a área de transferência; devolve se deu certo. */
export async function copyLink(invite: InviteDto): Promise<"copiado" | "falhou"> {
  try {
    await navigator.clipboard.writeText(invite.link);
    return "copiado";
  } catch {
    return "falhou";
  }
}

/**
 * Convites do Mini App. Só aparece para administradores: a API responde 403 aos demais e o cartão some.
 * Gerar, copiar, compartilhar e apagar; a lista mostra o estado de cada convite.
 */
export function InvitesCard() {
  const invites = useInvites();
  const create = useCreateInvite();
  const remove = useDeleteInvite();
  const [label, setLabel] = useState("");
  // Convite recém-gerado: mostra o link em destaque para compartilhar na hora.
  const [newInvite, setNewInvite] = useState<InviteDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Código do convite cuja exclusão está aguardando confirmação.
  const [confirmingDeleteCode, setConfirmingDeleteCode] = useState<string | null>(null);

  // Enquanto carrega e para quem não é administrador (403) o cartão não aparece.
  if (invites.isPending) return null;
  if (invites.isError && isForbidden(invites.error)) return null;

  async function generate() {
    setError(null);
    setNotice(null);
    try {
      const invite = await create.mutateAsync(label.trim() === "" ? undefined : label.trim());
      setLabel("");
      setNewInvite(invite);
      setNotice(`Convite criado. Vale por ${validityDays(invite)} dias e abre uma conta só.`);
    } catch (createError) {
      setError(messageFor(createError));
    }
  }

  async function share(invite: InviteDto) {
    setError(null);
    const result = await shareInvite(invite);
    if (result === "copiado") setNotice("Link copiado. É só colar na conversa.");
    else if (result === "falhou") setError("Não foi possível copiar. Selecione o link e copie.");
  }

  async function copy(invite: InviteDto) {
    setError(null);
    if ((await copyLink(invite)) === "copiado") setNotice("Link copiado.");
    else setError("Não foi possível copiar. Selecione o link e copie.");
  }

  async function confirmDelete(invite: InviteDto) {
    setError(null);
    try {
      await remove.mutateAsync(invite.code);
      if (newInvite?.code === invite.code) setNewInvite(null);
      setNotice(invite.status === "usado" ? "Convite apagado. A pessoa perdeu o acesso." : "Convite apagado.");
    } catch (deleteError) {
      setError(messageFor(deleteError));
    } finally {
      setConfirmingDeleteCode(null);
    }
  }

  const inviteList = invites.data?.invites ?? [];

  return (
    <section className="mini-card mini-tg" aria-labelledby="mini-inv-title" data-testid="invites-card">
      <h2 id="mini-inv-title" className="mini-tg-title">
        Convites
      </h2>
      <p className="mini-tg-text">Convide alguém para usar o Nexus. Cada convite abre uma conta só e tem validade.</p>

      {invites.isError && (
        <div className="mini-tg-block">
          <p role="alert" className="mini-fielderr">
            Não foi possível carregar os convites.
          </p>
          <button type="button" className="mini-btn" onClick={() => void invites.refetch()}>
            Tentar de novo
          </button>
        </div>
      )}

      <label htmlFor="mini-inv-label" className="mini-tg-text">
        Nome da pessoa (opcional, só para o seu controle)
      </label>
      <input
        id="mini-inv-label"
        className="mini-field"
        maxLength={INVITE_LABEL_MAX_LENGTH}
        autoComplete="off"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
      />
      <button
        type="button"
        className="mini-btn primary"
        disabled={create.isPending}
        onClick={() => void generate()}
        style={{ justifyContent: "center" }}
      >
        {create.isPending ? "Gerando…" : "Gerar convite"}
      </button>

      {newInvite !== null && (
        <div className="mini-tg-block">
          <label htmlFor="mini-inv-link" className="mini-tg-text">
            Link do convite
          </label>
          <input
            id="mini-inv-link"
            className="mini-field"
            readOnly
            value={newInvite.link}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="mini-tg-actions">
            <button type="button" className="mini-btn primary" onClick={() => void share(newInvite)}>
              Compartilhar
            </button>
            <button type="button" className="mini-btn" onClick={() => void copy(newInvite)}>
              Copiar link
            </button>
          </div>
        </div>
      )}

      {invites.data !== undefined && invites.data.summary.total > 0 && (
        <p className="mini-tg-text" data-testid="invites-summary">
          {summaryText(invites.data.summary)}
        </p>
      )}

      {inviteList.length === 0 && !invites.isError && <p className="mini-tg-text">Nenhum convite ainda. Gere o primeiro acima.</p>}

      {inviteList.length > 0 && (
        <ul className="mini-inv-list" aria-label="Convites criados">
          {inviteList.map((invite) => (
            <li key={invite.code} className="mini-inv-row">
              <p className="mini-tg-state">
                {invite.label !== null && <strong>{invite.label}: </strong>}
                {statusLabel(invite)}
              </p>
              {confirmingDeleteCode === invite.code ? (
                <div role="group" aria-label="Apagar este convite?" className="mini-tg-actions">
                  <p className="mini-tg-text">{deleteWarning(invite)}</p>
                  <button type="button" className="mini-btn danger" disabled={remove.isPending} onClick={() => void confirmDelete(invite)}>
                    {remove.isPending ? "Apagando…" : "Sim, apagar"}
                  </button>
                  <button type="button" className="mini-btn" disabled={remove.isPending} onClick={() => setConfirmingDeleteCode(null)}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="mini-tg-actions">
                  {invite.status === "ativo" && (
                    <button type="button" className="mini-btn" onClick={() => void share(invite)}>
                      Compartilhar
                    </button>
                  )}
                  <button type="button" className="mini-btn" aria-label={`Apagar o convite ${invite.code}`} onClick={() => setConfirmingDeleteCode(invite.code)}>
                    Apagar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {notice !== null && (
        <p role="status" className="mini-tg-text">
          {notice}
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
