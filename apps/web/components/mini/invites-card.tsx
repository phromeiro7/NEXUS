"use client";

import { useState } from "react";
import type { InviteDto } from "@aj/shared";
import { isForbidden, useCreateInvite, useInvites, useRevokeInvite } from "@/hooks/use-invites";
import { messageFor } from "@/lib/messages";

const SHARE_TEXT = "Entre no Nexus, meu assistente de tarefas e lembretes:";

const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

function validityDays(invite: InviteDto): number {
  return Math.max(1, Math.round((Date.parse(invite.expiresAt) - Date.parse(invite.createdAt)) / 86_400_000));
}

function statusLabel(invite: InviteDto): string {
  if (invite.status === "ativo") return `Ativo, vale até ${day(invite.expiresAt)}`;
  if (invite.status === "usado") return `Usado em ${invite.usedAt === null ? "—" : day(invite.usedAt)}`;
  if (invite.status === "expirado") return `Expirou em ${day(invite.expiresAt)}`;
  return "Revogado";
}

/**
 * Dentro do Telegram abre a tela de compartilhar dele; fora, usa o compartilhamento do aparelho e, sem ele,
 * copia o link. Devolve o que aconteceu, para avisar a pessoa.
 */
async function shareInvite(invite: InviteDto): Promise<"compartilhado" | "copiado" | "falhou" | "cancelado"> {
  const tg = typeof window === "undefined" ? undefined : window.Telegram?.WebApp;
  if (tg?.openTelegramLink && tg.platform !== "unknown") {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(invite.link)}&text=${encodeURIComponent(SHARE_TEXT)}`);
    return "compartilhado";
  }
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Nexus", text: SHARE_TEXT, url: invite.link });
      return "compartilhado";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelado";
    }
  }
  return copyLink(invite);
}

async function copyLink(invite: InviteDto): Promise<"copiado" | "falhou"> {
  try {
    await navigator.clipboard.writeText(invite.link);
    return "copiado";
  } catch {
    return "falhou";
  }
}

/**
 * Convites do Mini App. Só aparece para administradores: a API responde 403 aos demais e o cartão some.
 * Gerar, copiar, compartilhar e revogar; a lista mostra o estado de cada convite.
 */
export function InvitesCard() {
  const invites = useInvites();
  const create = useCreateInvite();
  const revoke = useRevokeInvite();
  const [fresh, setFresh] = useState<InviteDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  if (invites.isPending) return null;
  if (invites.isError && isForbidden(invites.error)) return null;

  async function generate() {
    setError(null);
    setNotice(null);
    try {
      const invite = await create.mutateAsync();
      setFresh(invite);
      setNotice(`Convite criado. Vale por ${validityDays(invite)} dias e abre uma conta só.`);
    } catch (err) {
      setError(messageFor(err));
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

  async function confirmRevoke(code: string) {
    setError(null);
    try {
      await revoke.mutateAsync(code);
      if (fresh?.code === code) setFresh(null);
      setNotice("Convite revogado.");
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setConfirming(null);
    }
  }

  const list = invites.data?.invites ?? [];

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

      <button
        type="button"
        className="mini-btn primary"
        disabled={create.isPending}
        onClick={() => void generate()}
        style={{ justifyContent: "center" }}
      >
        {create.isPending ? "Gerando…" : "Gerar convite"}
      </button>

      {fresh !== null && (
        <div className="mini-tg-block">
          <label htmlFor="mini-inv-link" className="mini-tg-text">
            Link do convite
          </label>
          <input
            id="mini-inv-link"
            className="mini-field"
            readOnly
            value={fresh.link}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="mini-tg-actions">
            <button type="button" className="mini-btn primary" onClick={() => void share(fresh)}>
              Compartilhar
            </button>
            <button type="button" className="mini-btn" onClick={() => void copy(fresh)}>
              Copiar link
            </button>
          </div>
        </div>
      )}

      {list.length === 0 && !invites.isError && <p className="mini-tg-text">Nenhum convite ainda. Gere o primeiro acima.</p>}

      {list.length > 0 && (
        <ul className="mini-inv-list" aria-label="Convites criados">
          {list.map((invite) => (
            <li key={invite.code} className="mini-inv-row">
              <p className="mini-tg-state">{statusLabel(invite)}</p>
              {invite.status === "ativo" &&
                (confirming === invite.code ? (
                  <div role="group" aria-label="Revogar este convite?" className="mini-tg-actions">
                    <button
                      type="button"
                      className="mini-btn danger"
                      disabled={revoke.isPending}
                      onClick={() => void confirmRevoke(invite.code)}
                    >
                      {revoke.isPending ? "Revogando…" : "Sim, revogar"}
                    </button>
                    <button type="button" className="mini-btn" disabled={revoke.isPending} onClick={() => setConfirming(null)}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="mini-tg-actions">
                    <button type="button" className="mini-btn" onClick={() => void share(invite)}>
                      Compartilhar
                    </button>
                    <button type="button" className="mini-btn" onClick={() => setConfirming(invite.code)}>
                      Revogar
                    </button>
                  </div>
                ))}
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
