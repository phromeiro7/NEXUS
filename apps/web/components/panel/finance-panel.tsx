"use client";

import { useState } from "react";
import type { IsoDate } from "@aj/shared";
import { EntryFormFields } from "@/components/mini/entry-form";
import { FinanceNotice } from "@/components/mini/finance-notice";
import { BackIcon, ChevronIcon, PlusIcon } from "@/components/mini/icons";
import { useToast } from "@/components/mini/toast";
import { useFinance } from "@/hooks/finance";
import { useToday } from "@/hooks/use-today";
import { formatShort } from "@/lib/dates";
import { formatBRL, formatBRLShort, hasMonthEntries, monthOf, monthTitle, monthTotals, shiftMonth, type Lancamento, type YearMonth } from "@/lib/finance";
import { monthRows, nextSort, rowActionLabel, situationLabel, sortRows, tableTotal, type Sort, type SortKey, type TableFilter } from "@/lib/finance-table";
import { CaptureBar } from "./capture-bar";
import { Dialog } from "./dialog";

const FILTERS: Array<{ key: TableFilter; label: string }> = [
  { key: "tudo", label: "Tudo" },
  { key: "gastos", label: "Gastos" },
  { key: "entradas", label: "Entradas" },
  { key: "contas", label: "Contas" },
];

export function FinancePanel() {
  const today = useToday();
  return (
    <>
      <CaptureBar />
      <div className="pn-body">
        {today === null ? (
          <div role="status" aria-label="Carregando">
            <h1 className="pn-h1">Finanças</h1>
            <div className="mini-skeleton" style={{ marginTop: 24 }} />
          </div>
        ) : (
          <FinanceContent today={today} />
        )}
      </div>
    </>
  );
}

function sentence(sobra: number, any: boolean): string {
  if (!any) return "Nada anotado neste mês.";
  return sobra >= 0 ? `Sobram ${formatBRLShort(sobra)} depois das contas.` : `Faltam ${formatBRLShort(-sobra)} para fechar as contas.`;
}

function dayCell(date: IsoDate): string {
  return formatShort(date);
}

function SortHeader({ label, k, sort, onSort, className }: { label: string; k: SortKey; sort: Sort; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort.key === k;
  return (
    <th scope="col" className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="pn-sortbtn" onClick={() => onSort(k)}>
        {label}
        <span aria-hidden="true">{active ? (sort.dir === "asc" ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );
}

function FinanceContent({ today }: { today: IsoDate }) {
  const finance = useFinance();
  const toast = useToast();
  const currentMonth = monthOf(today);
  const [ym, setYm] = useState<YearMonth>(currentMonth);
  const [filter, setFilter] = useState<TableFilter>("tudo");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "data", dir: "desc" });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Lancamento | null>(null);

  const list = finance.lancamentos;
  const totals = monthTotals(list, ym);
  const any = hasMonthEntries(list, ym);
  const rows = sortRows(monthRows(list, ym, { filter, query }), sort.key, sort.dir);
  const currentYear = Number(currentMonth.slice(0, 4));

  function settle(l: Lancamento) {
    finance.marcarPaga(l.id);
    toast({ message: `${l.tipo === "entrada" ? "Entrada recebida" : "Conta paga"}: ${l.descricao}.`, undo: () => finance.desmarcarPaga(l.id) });
  }
  function drop(l: Lancamento) {
    finance.remove(l.id);
    toast({ message: `Lançamento excluído: ${l.descricao}.`, undo: () => finance.restore(l) });
  }

  return (
    <section aria-labelledby="pn-h-fin">
      <div className="pn-title-row">
        <h1 id="pn-h-fin" className="pn-h1">
          Finanças
        </h1>
        <span className="pn-sub" style={{ fontSize: "1rem" }}>
          Gastos, entradas e contas do mês
        </span>
        <button type="button" className="mini-btn pn-small-btn" aria-label="Mês anterior" onClick={() => setYm(shiftMonth(ym, -1))}>
          <BackIcon />
        </button>
        <strong style={{ minWidth: 120, textAlign: "center", fontSize: "1.0625rem" }} aria-live="polite">
          {monthTitle(ym, currentYear)}
        </strong>
        <button type="button" className="mini-btn pn-small-btn" aria-label="Próximo mês" onClick={() => setYm(shiftMonth(ym, 1))}>
          <ChevronIcon />
        </button>
        <button type="button" className="mini-btn primary pn-small-btn" onClick={() => setAdding(true)}>
          <PlusIcon /> Novo lançamento
        </button>
      </div>

      <FinanceNotice />

      <p style={{ margin: "12px 0 0", fontSize: "1.25rem" }}>{sentence(totals.sobra, any)}</p>
      <dl className="pn-facts">
        <div>
          <dt>Entrou</dt>
          <dd>{formatBRL(totals.entrou)}</dd>
        </div>
        <div>
          <dt>Saiu</dt>
          <dd>{formatBRL(totals.saiu)}</dd>
        </div>
        <div>
          <dt>Falta pagar</dt>
          <dd>{formatBRL(totals.aPagar)}</dd>
        </div>
      </dl>

      <div className="pn-tools">
        <label htmlFor="pn-busca" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
          Buscar lançamento
        </label>
        <input id="pn-busca" type="search" className="mini-field" value={query} placeholder="Buscar por nome ou categoria" onChange={(e) => setQuery(e.target.value)} />
        <div role="group" aria-label="Filtrar por tipo" className="mini-chips">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className="mini-chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pn-table-wrap">
        {finance.loading ? (
          <div role="status" aria-label="Carregando lançamentos" className="mini-skeleton" />
        ) : (
          <table className="pn-table">
            <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>Lançamentos do mês</caption>
            <thead>
              <tr>
                <SortHeader label="Data" k="data" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
                <SortHeader label="Descrição" k="descricao" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
                <th scope="col">Categoria</th>
                <th scope="col">Situação</th>
                <SortHeader label="Valor" k="valor" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} className="num" />
                <th scope="col">
                  <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const action = rowActionLabel(l);
                const late = l.situacao === "a_pagar" && l.data < today;
                return (
                  <tr key={l.id}>
                    <td style={{ fontVariantNumeric: "tabular-nums" }} className="pn-sub">
                      {dayCell(l.data)}
                    </td>
                    <td style={{ fontWeight: 600 }}>{l.descricao}</td>
                    <td className="pn-sub">{l.categoria ?? "—"}</td>
                    <td className={late ? "pn-status-late" : undefined}>{situationLabel(l, today)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {l.tipo === "entrada" ? "+ " : "− "}
                      {formatBRL(l.valorCentavos)}
                    </td>
                    <td className="act">
                      {action !== null && (
                        <button type="button" className="mini-btn pn-small-btn" aria-label={`${action}: ${l.descricao}`} onClick={() => settle(l)}>
                          {action}
                        </button>
                      )}
                      <button type="button" className="mini-btn quiet pn-small-btn" aria-label={`Editar: ${l.descricao}`} onClick={() => setEditing(l)}>
                        Editar
                      </button>
                      <button type="button" className="mini-btn quiet pn-small-btn" aria-label={`Excluir: ${l.descricao}`} onClick={() => drop(l)}>
                        Excluir
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={4}>Total do que está na tabela</td>
                  <td className="num">{formatBRL(tableTotal(rows))}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        )}
        {!finance.loading && rows.length === 0 && (
          <p className="pn-empty">
            {any ? "Nenhum lançamento com esse filtro ou busca." : `Nada anotado em ${monthTitle(ym, currentYear)}. Use a barra de cima ou “Novo lançamento”.`}
          </p>
        )}
      </div>

      {adding && (
        <Dialog title="Novo lançamento" onClose={() => setAdding(false)}>
          <EntryFormFields today={today} onSaved={() => setAdding(false)} />
        </Dialog>
      )}
      {editing && (
        <Dialog title="Editar lançamento" onClose={() => setEditing(null)}>
          <EntryFormFields today={today} entry={editing} onSaved={() => setEditing(null)} />
        </Dialog>
      )}
    </section>
  );
}
