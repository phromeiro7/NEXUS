"use client";

import Link from "next/link";
import { useState } from "react";
import type { InviteDto } from "@aj/shared";
import { copyLink, shareInvite, statusLabel, validityDays } from "@/components/mini/invites-card";
import { isForbidden, useCreateInvite, useInvites, useRevokeInvite } from "@/hooks/use-invites";
import { messageFor } from "@/lib/messages";

const created = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

/** Convites (só administradores): gerar, copiar, compartilhar e revogar. Quem não administra vê um aviso gentil. */
export function InvitesPanel() {
  const invites = useInvites();
  const create = useCreateInvite();
  const revoke = useRevokeInvite();
  const [fresh, setFresh] = useState<InviteDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  if (invites.isPending) {
    return (
      <div className="pn-body">
        <div role="status" aria-label="Carregando convites" className="mini-skeleton" />
      </div>
    );
  }
  if (invites.isError && isForbidden(invites.error)) {
    return (
      <div className="pn-body">
        <h1 className="pn-h1">Convites</h1>
        <p className="pn-lead">Só quem administra o Nexus vê esta página.</p>
        <p style={{ marginTop: 16 }}>
          <Link href="/" className="mini-btn pn-small-btn">
            Voltar para Hoje
          </Link>
        </p>
      </div>
    );
  }

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
    <div className="pn-body">
      <section aria-labelledby="pn-h-inv" style={{ maxWidth: 900 }}>
        <h1 id="pn-h-inv" className="pn-h1">
          Convites
        </h1>
        <p className="pn-sub" style={{ margin: "8px 0 24px", fontSize: "1rem" }}>
          Cada convite vale por 7 dias e abre uma conta só. Só administradores veem esta página.
        </p>

        {invites.isError && (
          <div role="alert" className="mini-alert" style={{ marginTop: 0, marginBottom: 16 }}>
            <p style={{ margin: 0 }}>Não foi possível carregar os convites.</p>
            <button type="button" className="mini-btn" style={{ marginTop: 10 }} onClick={() => void invites.refetch()}>
              Tentar de novo
            </button>
          </div>
        )}

        <button type="button" className="mini-btn primary" disabled={create.isPending} onClick={() => void generate()}>
          {create.isPending ? "Gerando…" : "Gerar convite"}
        </button>

        {fresh !== null && (
          <div className="pn-invite-box">
            <p>
              <strong>Convite criado.</strong> Vale por {validityDays(fresh)} dias e abre uma conta só.
            </p>
            <label className="mini-label">
              Link para enviar
              <input className="mini-field" readOnly value={fresh.link} onFocus={(e) => e.currentTarget.select()} />
            </label>
            <div className="pn-dialog-actions">
              <button type="button" className="mini-btn primary pn-small-btn" onClick={() => void copy(fresh)}>
                Copiar link
              </button>
              <button type="button" className="mini-btn pn-small-btn" onClick={() => void share(fresh)}>
                Compartilhar
              </button>
            </div>
          </div>
        )}

        {notice !== null && (
          <p role="status" className="pn-sub" style={{ margin: "12px 0 0" }}>
            {notice}
          </p>
        )}
        {error !== null && (
          <p role="alert" className="mini-fielderr" style={{ margin: "12px 0 0" }}>
            {error}
          </p>
        )}

        <h2 className="pn-h2">Todos os convites</h2>
        <div className="pn-table-wrap">
          <table className="pn-table">
            <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>Convites gerados</caption>
            <thead>
              <tr>
                <th scope="col">Convite</th>
                <th scope="col">Criado</th>
                <th scope="col">Situação</th>
                <th scope="col">
                  <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((invite) => (
                <tr key={invite.code}>
                  <td style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{invite.code}</td>
                  <td className="pn-sub">{created(invite.createdAt)}</td>
                  <td>{statusLabel(invite)}</td>
                  <td className="act">
                    {invite.status === "ativo" &&
                      (confirming === invite.code ? (
                        <span role="group" aria-label="Revogar este convite?">
                          <button type="button" className="mini-btn danger pn-small-btn" disabled={revoke.isPending} onClick={() => void confirmRevoke(invite.code)}>
                            {revoke.isPending ? "Revogando…" : "Sim, revogar"}
                          </button>
                          <button type="button" className="mini-btn pn-small-btn" disabled={revoke.isPending} onClick={() => setConfirming(null)}>
                            Cancelar
                          </button>
                        </span>
                      ) : (
                        <>
                          <button type="button" className="mini-btn pn-small-btn" onClick={() => void share(invite)}>
                            Compartilhar
                          </button>
                          <button type="button" className="mini-btn pn-small-btn" aria-label={`Revogar o convite ${invite.code}`} onClick={() => setConfirming(invite.code)}>
                            Revogar
                          </button>
                        </>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && !invites.isError && <p className="pn-empty">Nenhum convite ainda. Gere o primeiro acima.</p>}
        </div>
      </section>
    </div>
  );
}
