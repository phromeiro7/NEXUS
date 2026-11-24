"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import type { InviteDto } from "@nexus/shared";
import { copyLink, deleteWarning, shareInvite, statusLabel, summaryText, validityDays } from "@/components/mini/invites-card";
import { isForbidden, useCreateInvite, useInvites, useDeleteInvite } from "@/hooks/use-invites";
import { messageFor } from "@/lib/messages";

/** Esconde o elemento na tela mantendo-o para leitores de tela (rótulos de busca, legendas de tabela). */
const VISUALLY_HIDDEN_STYLE: CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

/** Limite do nome do convidado (só para controle de quem gera o convite). */
const INVITE_LABEL_MAX_LENGTH = 60;

/** Data de criação no formato "dd/mm". */
const formatCreatedDate = (isoDate: string) => new Date(isoDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

/** Convites (só administradores): gerar, copiar, compartilhar e apagar. Quem não administra vê um aviso gentil. */
export function InvitesPanel() {
  const invites = useInvites();
  const createInvite = useCreateInvite();
  const deleteInvite = useDeleteInvite();
  const [label, setLabel] = useState("");
  // Convite recém-gerado, destacado com o link para copiar/compartilhar.
  const [newInvite, setNewInvite] = useState<InviteDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Código do convite cuja exclusão aguarda confirmação na própria linha.
  const [confirmingDeleteCode, setConfirmingDeleteCode] = useState<string | null>(null);

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

  async function generateInvite() {
    setError(null);
    setNotice(null);
    try {
      const trimmedLabel = label.trim();
      const invite = await createInvite.mutateAsync(trimmedLabel === "" ? undefined : trimmedLabel);
      setLabel("");
      setNewInvite(invite);
      setNotice(`Convite criado. Vale por ${validityDays(invite)} dias e abre uma conta só.`);
    } catch (caughtError) {
      setError(messageFor(caughtError));
    }
  }
  // Compartilhamento nativo quando houver; senão copia (o resultado diz qual aconteceu).
  async function share(invite: InviteDto) {
    setError(null);
    const result = await shareInvite(invite);
    if (result === "copiado") setNotice("Link copiado. É só colar na conversa.");
    else if (result === "falhou") setError("Não foi possível copiar. Selecione o link e copie.");
  }
  async function copyInviteLink(invite: InviteDto) {
    setError(null);
    if ((await copyLink(invite)) === "copiado") setNotice("Link copiado.");
    else setError("Não foi possível copiar. Selecione o link e copie.");
  }
  async function confirmDelete(invite: InviteDto) {
    setError(null);
    try {
      await deleteInvite.mutateAsync(invite.code);
      if (newInvite?.code === invite.code) setNewInvite(null);
      setNotice(invite.status === "usado" ? "Convite apagado. A pessoa perdeu o acesso." : "Convite apagado.");
    } catch (caughtError) {
      setError(messageFor(caughtError));
    } finally {
      setConfirmingDeleteCode(null);
    }
  }

  const inviteList = invites.data?.invites ?? [];

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

        <label className="mini-label" style={{ maxWidth: 360, marginBottom: 12 }}>
          Nome da pessoa (opcional, só para o seu controle)
          <input className="mini-field" maxLength={INVITE_LABEL_MAX_LENGTH} autoComplete="off" value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <button type="button" className="mini-btn primary" disabled={createInvite.isPending} onClick={() => void generateInvite()}>
          {createInvite.isPending ? "Gerando…" : "Gerar convite"}
        </button>

        {newInvite !== null && (
          <div className="pn-invite-box">
            <p>
              <strong>Convite criado.</strong> Vale por {validityDays(newInvite)} dias e abre uma conta só.
            </p>
            <label className="mini-label">
              Link para enviar
              <input className="mini-field" readOnly value={newInvite.link} onFocus={(event) => event.currentTarget.select()} />
            </label>
            <div className="pn-dialog-actions">
              <button type="button" className="mini-btn primary pn-small-btn" onClick={() => void copyInviteLink(newInvite)}>
                Copiar link
              </button>
              <button type="button" className="mini-btn pn-small-btn" onClick={() => void share(newInvite)}>
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
        {invites.data !== undefined && invites.data.summary.total > 0 && (
          <p className="pn-sub" data-testid="invites-summary" style={{ margin: "0 0 12px" }}>
            {summaryText(invites.data.summary)}
          </p>
        )}
        <div className="pn-table-wrap">
          <table className="pn-table">
            <caption style={VISUALLY_HIDDEN_STYLE}>Convites gerados</caption>
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Convite</th>
                <th scope="col">Criado</th>
                <th scope="col">Situação</th>
                <th scope="col">
                  <span style={VISUALLY_HIDDEN_STYLE}>Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {inviteList.map((invite) => (
                <tr key={invite.code}>
                  <td style={{ fontWeight: 600 }}>{invite.label ?? "—"}</td>
                  <td className="pn-sub" style={{ fontVariantNumeric: "tabular-nums" }}>{invite.code}</td>
                  <td className="pn-sub">{formatCreatedDate(invite.createdAt)}</td>
                  <td>{statusLabel(invite)}</td>
                  <td className="act">
                    {confirmingDeleteCode === invite.code ? (
                      <span role="group" aria-label="Apagar este convite?">
                        <span className="pn-sub" style={{ display: "block", marginBottom: 6 }}>
                          {deleteWarning(invite)}
                        </span>
                        <button type="button" className="mini-btn danger pn-small-btn" disabled={deleteInvite.isPending} onClick={() => void confirmDelete(invite)}>
                          {deleteInvite.isPending ? "Apagando…" : "Sim, apagar"}
                        </button>
                        <button type="button" className="mini-btn pn-small-btn" disabled={deleteInvite.isPending} onClick={() => setConfirmingDeleteCode(null)}>
                          Cancelar
                        </button>
                      </span>
                    ) : (
                      <>
                        {invite.status === "ativo" && (
                          <button type="button" className="mini-btn pn-small-btn" onClick={() => void share(invite)}>
                            Compartilhar
                          </button>
                        )}
                        <button type="button" className="mini-btn pn-small-btn" aria-label={`Apagar o convite ${invite.code}`} onClick={() => setConfirmingDeleteCode(invite.code)}>
                          Apagar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {inviteList.length === 0 && !invites.isError && <p className="pn-empty">Nenhum convite ainda. Gere o primeiro acima.</p>}
        </div>
      </section>
    </div>
  );
}
