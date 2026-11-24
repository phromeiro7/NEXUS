"use client";

import { useState, type CSSProperties } from "react";
import type { IsoDate } from "@nexus/shared";
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

/** Esconde o elemento na tela mantendo-o para leitores de tela (rótulos de busca, legendas de tabela). */
const VISUALLY_HIDDEN_STYLE: CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

const FILTERS: Array<{ key: TableFilter; label: string }> = [
  { key: "tudo", label: "Tudo" },
  { key: "gastos", label: "Gastos" },
  { key: "entradas", label: "Entradas" },
  { key: "contas", label: "Contas" },
];

/** Tela "Finanças" do painel: resumo do mês, tabela de lançamentos com busca, filtro e ordenação. */
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

/** Frase de resumo do mês: quanto sobra (ou falta) depois das contas. */
function describeMonthBalance(balanceCents: number, hasEntries: boolean): string {
  if (!hasEntries) return "Nada anotado neste mês.";
  return balanceCents >= 0
    ? `Sobram ${formatBRLShort(balanceCents)} depois das contas.`
    : `Faltam ${formatBRLShort(-balanceCents)} para fechar as contas.`;
}

/** Cabeçalho de coluna ordenável: anuncia a direção em `aria-sort` e mostra a seta. */
function SortHeader({ label, k: sortKey, sort, onSort, className }: { label: string; k: SortKey; sort: Sort; onSort: (sortKey: SortKey) => void; className?: string }) {
  const isActive = sort.key === sortKey;
  const isAscending = sort.dir === "asc";
  return (
    <th scope="col" className={className} aria-sort={isActive ? (isAscending ? "ascending" : "descending") : "none"}>
      <button type="button" className="pn-sortbtn" onClick={() => onSort(sortKey)}>
        {label}
        <span aria-hidden="true">{isActive ? (isAscending ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );
}

function FinanceContent({ today }: { today: IsoDate }) {
  const finance = useFinance();
  const toast = useToast();
  const currentMonth = monthOf(today);
  const [selectedMonth, setSelectedMonth] = useState<YearMonth>(currentMonth);
  const [filter, setFilter] = useState<TableFilter>("tudo");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "data", dir: "desc" });
  const [adding, setAdding] = useState(false);

  const entries = finance.lancamentos;
  const totals = monthTotals(entries, selectedMonth);
  const hasEntries = hasMonthEntries(entries, selectedMonth);
  const rows = sortRows(monthRows(entries, selectedMonth, { filter, query }), sort.key, sort.dir);
  // Ano corrente: o título do mês só mostra o ano quando ele é outro.
  const currentYear = Number(currentMonth.slice(0, 4));
  const changeSort = (sortKey: SortKey) => setSort(nextSort(sort, sortKey));

  function settleEntry(entry: Lancamento) {
    finance.marcarPaga(entry.id);
    toast({ message: `${entry.tipo === "entrada" ? "Entrada recebida" : "Conta paga"}: ${entry.descricao}.`, undo: () => finance.desmarcarPaga(entry.id) });
  }
  function deleteEntry(entry: Lancamento) {
    finance.remove(entry.id);
    toast({ message: `Lançamento excluído: ${entry.descricao}.`, undo: () => finance.restore(entry) });
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
        <button type="button" className="mini-btn pn-small-btn" aria-label="Mês anterior" onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))}>
          <BackIcon />
        </button>
        <strong style={{ minWidth: 120, textAlign: "center", fontSize: "1.0625rem" }} aria-live="polite">
          {monthTitle(selectedMonth, currentYear)}
        </strong>
        <button type="button" className="mini-btn pn-small-btn" aria-label="Próximo mês" onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))}>
          <ChevronIcon />
        </button>
        <button type="button" className="mini-btn primary pn-small-btn" onClick={() => setAdding(true)}>
          <PlusIcon /> Novo lançamento
        </button>
      </div>

      <FinanceNotice />

      <p style={{ margin: "12px 0 0", fontSize: "1.25rem" }}>{describeMonthBalance(totals.sobra, hasEntries)}</p>
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
        <label htmlFor="pn-busca" style={VISUALLY_HIDDEN_STYLE}>
          Buscar lançamento
        </label>
        <input id="pn-busca" type="search" className="mini-field" value={query} placeholder="Buscar por nome ou categoria" onChange={(event) => setQuery(event.target.value)} />
        <div role="group" aria-label="Filtrar por tipo" className="mini-chips">
          {FILTERS.map((filterOption) => (
            <button key={filterOption.key} type="button" className="mini-chip" aria-pressed={filter === filterOption.key} onClick={() => setFilter(filterOption.key)}>
              {filterOption.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pn-table-wrap">
        {finance.loading ? (
          <div role="status" aria-label="Carregando lançamentos" className="mini-skeleton" />
        ) : (
          <table className="pn-table">
            <caption style={VISUALLY_HIDDEN_STYLE}>Lançamentos do mês</caption>
            <thead>
              <tr>
                <SortHeader label="Data" k="data" sort={sort} onSort={changeSort} />
                <SortHeader label="Descrição" k="descricao" sort={sort} onSort={changeSort} />
                <th scope="col">Categoria</th>
                <th scope="col">Situação</th>
                <SortHeader label="Valor" k="valor" sort={sort} onSort={changeSort} className="num" />
                <th scope="col">
                  <span style={VISUALLY_HIDDEN_STYLE}>Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => {
                const actionLabel = rowActionLabel(entry);
                const isLate = entry.situacao === "a_pagar" && entry.data < today;
                return (
                  <tr key={entry.id}>
                    <td style={{ fontVariantNumeric: "tabular-nums" }} className="pn-sub">
                      {formatShort(entry.data)}
                    </td>
                    <td style={{ fontWeight: 600 }}>{entry.descricao}</td>
                    <td className="pn-sub">{entry.categoria ?? "—"}</td>
                    <td className={isLate ? "pn-status-late" : undefined}>{situationLabel(entry, today)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {entry.tipo === "entrada" ? "+ " : "− "}
                      {formatBRL(entry.valorCentavos)}
                    </td>
                    <td className="act">
                      {actionLabel !== null && (
                        <button type="button" className="mini-btn pn-small-btn" aria-label={`${actionLabel}: ${entry.descricao}`} onClick={() => settleEntry(entry)}>
                          {actionLabel}
                        </button>
                      )}
                      <button type="button" className="mini-btn quiet pn-small-btn" aria-label={`Excluir: ${entry.descricao}`} onClick={() => deleteEntry(entry)}>
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
            {hasEntries ? "Nenhum lançamento com esse filtro ou busca." : `Nada anotado em ${monthTitle(selectedMonth, currentYear)}. Use a barra de cima ou “Novo lançamento”.`}
          </p>
        )}
      </div>

      {adding && (
        <Dialog title="Novo lançamento" onClose={() => setAdding(false)}>
          <EntryFormFields today={today} onSaved={() => setAdding(false)} />
        </Dialog>
      )}
    </section>
  );
}
