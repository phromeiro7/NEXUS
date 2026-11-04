"use client";

import Link from "next/link";
import { useState } from "react";
import type { IsoDate } from "@aj/shared";
import { useFinance } from "@/hooks/finance";
import { FinanceNotice } from "./finance-notice";
import { useToday } from "@/hooks/use-today";
import {
  billsOfMonth,
  byCategory,
  formatBRL,
  formatBRLShort,
  hasMonthEntries,
  monthOf,
  monthTitle,
  monthTotals,
  receivablesOfMonth,
  shiftMonth,
  type Lancamento,
  type YearMonth,
} from "@/lib/finance";
import { BillItem } from "./bill-item";
import { BackIcon, ChevronIcon, PlusIcon } from "./icons";
import { useToast } from "./toast";

export function FinanceScreen() {
  const today = useToday();
  if (today === null) {
    return (
      <div role="status" aria-label="Carregando">
        <div className="mini-hero">
          <h1>Finanças</h1>
        </div>
        <div className="mini-list" style={{ marginTop: 24 }}>
          <div className="mini-skeleton" />
          <div className="mini-skeleton" />
        </div>
      </div>
    );
  }
  return <FinanceContent today={today} />;
}

function summarySentence(sobra: number, any: boolean): string {
  if (!any) return "Nada anotado neste mês";
  if (sobra >= 0) return `Sobram ${formatBRLShort(sobra)} depois das contas`;
  return `Faltam ${formatBRLShort(-sobra)} para fechar as contas`;
}

function FinanceContent({ today }: { today: IsoDate }) {
  const finance = useFinance();
  const toast = useToast();
  const currentMonth = monthOf(today);
  const [ym, setYm] = useState<YearMonth>(currentMonth);

  const list = finance.lancamentos;
  const totals = monthTotals(list, ym);
  const any = hasMonthEntries(list, ym);
  const categories = byCategory(list, ym);
  const spent = categories.reduce((n, c) => n + c.total, 0);
  const bills = billsOfMonth(list, ym);
  const receivables = receivablesOfMonth(list, ym);
  const year = Number(today.slice(0, 4));

  function settle(item: Lancamento) {
    finance.marcarPaga(item.id);
    toast({
      message: `${item.tipo === "entrada" ? "Recebido" : "Paga"}: ${item.descricao}.`,
      undo: () => finance.desmarcarPaga(item.id),
    });
  }

  return (
    <main>
      <header className="mini-hero">
        <h1>Finanças</h1>
        <p className="mini-hero-date">Entradas, gastos e contas</p>
        <p className="mini-hero-summary">{finance.loading ? "Carregando…" : finance.error === "load" ? "Lançamentos indisponíveis agora" : summarySentence(totals.sobra, any)}</p>
      </header>

      <FinanceNotice />

      <div className="mini-monthnav">
        <button type="button" className="mini-icon-btn" aria-label="Mês anterior" onClick={() => setYm(shiftMonth(ym, -1))}>
          <BackIcon />
        </button>
        <h2 aria-live="polite">{monthTitle(ym, year)}</h2>
        <button type="button" className="mini-icon-btn" aria-label="Próximo mês" onClick={() => setYm(shiftMonth(ym, 1))}>
          <ChevronIcon />
        </button>
      </div>

      {any && (
        <section className="mini-section" aria-label="Resumo do mês">
          <dl className="mini-list grouped mini-money">
            <div>
              <dt>Entrou</dt>
              <dd>{formatBRL(totals.entrou)}</dd>
            </div>
            <div>
              <dt>Saiu</dt>
              <dd>{formatBRL(totals.saiu)}</dd>
            </div>
            <div>
              <dt>Ainda a pagar</dt>
              <dd>{formatBRL(totals.aPagar)}</dd>
            </div>
          </dl>
        </section>
      )}

      <Link href="/mini/financas/novo" className="mini-btn primary" style={{ width: "100%", marginTop: 16 }}>
        <PlusIcon /> Anotar gasto, conta ou entrada
      </Link>

      {finance.loading && (
        <div role="status" aria-label="Carregando lançamentos" className="mini-list" style={{ marginTop: 28 }}>
          <div className="mini-skeleton" />
          <div className="mini-skeleton" />
        </div>
      )}

      {!any && !finance.loading && finance.error === null && (
        <div className="mini-empty">
          <strong>Nada anotado em {monthTitle(ym, year).toLowerCase()}.</strong>
          {ym === currentMonth
            ? "Anote um gasto, uma conta a pagar ou uma entrada para ver quanto sobra."
            : "Use as setas para voltar ao mês com lançamentos."}
        </div>
      )}

      {categories.length > 0 && (
        <section className="mini-section" aria-labelledby="h-onde">
          <h2 id="h-onde">Para onde foi</h2>
          <ul className="mini-list grouped">
            {categories.map((c) => (
              <li key={c.categoria} className="mini-cat">
                <strong>{c.categoria}</strong>
                <span>
                  {formatBRL(c.total)} <small>{Math.round((c.total / spent) * 100)}%</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {any && (
        <section className="mini-section" aria-labelledby="h-contas">
          <h2 id="h-contas">
            Contas do mês <span className="mini-count">{bills.length}</span>
          </h2>
          {bills.length === 0 ? (
            <p className="mini-hint">Nenhuma conta a pagar neste mês.</p>
          ) : (
            <ul className="mini-list grouped">
              {bills.map((b, i) => (
                <BillItem key={b.id} bill={b} today={today} onPay={settle} index={i} />
              ))}
            </ul>
          )}
        </section>
      )}

      {receivables.length > 0 && (
        <section className="mini-section" aria-labelledby="h-receber">
          <h2 id="h-receber">
            A receber <span className="mini-count">{receivables.length}</span>
          </h2>
          <ul className="mini-list grouped">
            {receivables.map((b, i) => (
              <BillItem key={b.id} bill={b} today={today} onPay={settle} index={i} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
