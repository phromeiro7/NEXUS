"use client";

import { useFinance, useLocalImport } from "@/hooks/finance";

/** Avisos do controle financeiro: falha ao carregar/salvar e a importação única dos dados deste aparelho. */
export function FinanceNotice() {
  const finance = useFinance();
  const local = useLocalImport();

  return (
    <>
      {finance.error === "load" && (
        <div role="alert" className="mini-alert">
          <p style={{ margin: 0 }}>Não foi possível carregar seus lançamentos. Nada foi perdido.</p>
          <button type="button" className="mini-btn" style={{ marginTop: 10 }} onClick={finance.reload}>
            Tentar de novo
          </button>
        </div>
      )}
      {finance.error === "save" && (
        <div role="alert" className="mini-alert">
          <p style={{ margin: 0 }}>Não foi possível salvar a última alteração. A tela voltou ao que está guardado.</p>
          <button type="button" className="mini-btn quiet" style={{ marginTop: 6 }} onClick={finance.dismissError}>
            Entendi
          </button>
        </div>
      )}
      {local.count > 0 && (
        <section className="mini-alert" aria-label="Lançamentos deste aparelho">
          <p style={{ margin: 0 }}>
            {local.count === 1 ? "Há 1 lançamento" : `Há ${local.count} lançamentos`} salvo{local.count === 1 ? "" : "s"} só neste
            aparelho. Importe para vê-los em qualquer lugar.
          </p>
          {local.failed && (
            <p role="alert" className="mini-fielderr" style={{ marginTop: 8 }}>
              Não deu para importar agora. Tente de novo: o que já foi não se repete.
            </p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button type="button" className="mini-btn primary" disabled={local.importing} onClick={() => void local.importar()}>
              {local.importing ? "Importando…" : "Importar para a sua conta"}
            </button>
            <button type="button" className="mini-btn quiet" disabled={local.importing} onClick={local.descartar}>
              Descartar do aparelho
            </button>
          </div>
        </section>
      )}
    </>
  );
}
