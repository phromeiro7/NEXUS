"use client";

import { useState } from "react";
import Link from "next/link";
import type { IsoDate, TaskDto, TaskStatus } from "@nexus/shared";
import { useFinance } from "@/hooks/finance";
import { FinanceNotice } from "./finance-notice";
import { usePostpone } from "@/hooks/use-postpone";
import { useStatusChange } from "@/hooks/use-status-change";
import { useSettings, useTasks } from "@/hooks/queries";
import { useClock } from "@/hooks/use-clock";
import { useToday } from "@/hooks/use-today";
import { addDays } from "@/lib/dates";
import { dueBills, formatBRLShort, hasMonthEntries, monthName, monthOf, monthTotals, type Lancamento } from "@/lib/finance";
import { dayTitle, nextUp, pluralTasks, spokenTime } from "@/lib/mini-tasks";
import { postponeInput, type PostponeKind } from "@/lib/postpone";
import { groupDay } from "@/lib/tasks-view";
import { BillItem } from "./bill-item";
import { Capture } from "./capture";
import { ChevronIcon, PlusIcon } from "./icons";
import { TaskItem } from "./task-item";
import { useToast } from "./toast";

const OPEN = ["pendente", "em_andamento"] as TaskStatus[];

function dayHeading(date: IsoDate): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function TodayScreen() {
  const today = useToday();
  if (today === null) {
    return (
      <div role="status" aria-label="Carregando">
        <div className="mini-hero">
          <h1>Hoje</h1>
        </div>
        <div className="mini-list" style={{ marginTop: 24 }}>
          <div className="mini-skeleton" />
          <div className="mini-skeleton" />
        </div>
      </div>
    );
  }
  return <TodayContent today={today} />;
}

/** Uma linha com o mês: só aparece quando há lançamentos, e leva às Finanças. */
function MonthLine({ today, list }: { today: IsoDate; list: readonly Lancamento[] }) {
  const ym = monthOf(today);
  if (!hasMonthEntries(list, ym)) return null;
  const { sobra } = monthTotals(list, ym);
  return (
    <Link href="/mini/financas" className="mini-monthline">
      <span>
        {monthName(ym)}: {sobra >= 0 ? `sobram ${formatBRLShort(sobra)} depois das contas` : `faltam ${formatBRLShort(-sobra)} para fechar as contas`}
      </span>
      <ChevronIcon />
    </Link>
  );
}

/** Escolha simples entre anotar uma tarefa (a captura da tela) e um lançamento financeiro. */
function AddChoice() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        className="mini-btn"
        style={{ width: "100%" }}
        aria-expanded={open}
        aria-controls="mini-add-choice"
        onClick={() => setOpen((v) => !v)}
      >
        <PlusIcon /> Anotar tarefa ou gasto
      </button>
      {open && (
        <div id="mini-add-choice" className="mini-sheet">
          <button
            type="button"
            className="mini-btn"
            onClick={() => {
              setOpen(false);
              const field = document.querySelector<HTMLInputElement>("[data-capture-title]");
              field?.scrollIntoView({ block: "center" });
              field?.focus();
            }}
          >
            Tarefa ou lembrete
          </button>
          <Link href="/mini/financas/novo" className="mini-btn">
            Gasto, conta ou entrada
          </Link>
        </div>
      )}
    </div>
  );
}

function TodayContent({ today }: { today: IsoDate }) {
  const overdueQ = useTasks({ status: OPEN, to: addDays(today, -1) });
  const todayQ = useTasks({ status: OPEN, from: today, to: today });
  const undatedQ = useTasks({ status: OPEN, withoutDate: true });
  const nextQ = useTasks({ status: OPEN, from: addDays(today, 1), to: addDays(today, 7) });
  const { error, change } = useStatusChange();
  const postponer = usePostpone();
  const toast = useToast();
  const clock = useClock(useSettings().data?.timezone);
  const finance = useFinance();
  const bills = dueBills(finance.lancamentos, today);
  const billCount = bills.overdue.length + bills.today.length;

  const overdue = groupDay(overdueQ.data ?? [], today).overdue;
  const day = groupDay(todayQ.data ?? [], today);
  const todayItems = [...day.fatalToday, ...day.timed, ...day.dateOnly];
  const undated = groupDay(undatedQ.data ?? [], today).undated;
  const upcoming = [...(nextQ.data ?? [])].sort((a, b) =>
    (a.dueDate ?? "") === (b.dueDate ?? "") ? (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99") : (a.dueDate ?? "") < (b.dueDate ?? "") ? -1 : 1,
  );
  const byDate = new Map<IsoDate, TaskDto[]>();
  for (const t of upcoming) if (t.dueDate) byDate.set(t.dueDate, [...(byDate.get(t.dueDate) ?? []), t]);

  const loading = overdueQ.isPending || todayQ.isPending || undatedQ.isPending;
  const failed = overdueQ.isError || todayQ.isError || undatedQ.isError;
  const total = overdue.length + todayItems.length;
  const next = loading || failed ? null : nextUp(todayItems, clock);

  function payBill(bill: Lancamento) {
    finance.marcarPaga(bill.id);
    toast({ message: `Conta paga: ${bill.descricao}.`, undo: () => finance.desmarcarPaga(bill.id) });
  }

  function complete(task: TaskDto) {
    void change(task.id, "concluida");
    toast({ message: `Tarefa concluída: ${task.title}.`, undo: () => void change(task.id, "pendente") });
  }

  function postponeTask(task: TaskDto, kind: PostponeKind) {
    void postponer.postpone(task, postponeInput(task, kind, today), today);
  }

  const section = (title: string, items: TaskDto[], opts: { cls?: string; compact?: boolean; bills?: Lancamento[] } = {}) =>
    items.length + (opts.bills?.length ?? 0) > 0 && (
      <section className={`mini-section ${opts.cls ?? ""}`} aria-labelledby={`h-${title}`}>
        <h2 id={`h-${title}`}>
          {title} <span className="mini-count">{items.length + (opts.bills?.length ?? 0)}</span>
        </h2>
        <ul className="mini-list grouped">
          {items.map((t, i) => (
            <TaskItem key={t.id} task={t} today={today} onComplete={complete} onPostpone={postponeTask} index={i} compact={opts.compact} />
          ))}
          {(opts.bills ?? []).map((b, i) => (
            <BillItem key={b.id} bill={b} today={today} onPay={payBill} index={items.length + i} />
          ))}
        </ul>
      </section>
    );

  return (
    <main>
      <header className="mini-hero">
        <h1>Hoje</h1>
        <p className="mini-hero-date">{dayHeading(today)}</p>
        {!loading && !failed && (
          <p className="mini-hero-summary">
            {pluralTasks(total)}
            {overdue.length > 0 && ` · ${overdue.length} ${overdue.length === 1 ? "atrasada" : "atrasadas"}`}
            {billCount > 0 && ` · ${billCount} ${billCount === 1 ? "conta" : "contas"}`}
          </p>
        )}
        {next && (
          <Link href={`/mini/tarefa/${next.id}`} className="mini-next">
            <span className="mini-dot" aria-hidden="true" />
            <span className="mini-next-text">
              <small>Próxima</small>
              <strong>{next.title}</strong>
            </span>
            <span className="mini-next-time">{spokenTime(next.dueTime ?? "")}</span>
            <ChevronIcon />
          </Link>
        )}
      </header>

      <FinanceNotice />

      <MonthLine today={today} list={finance.lancamentos} />

      <Capture today={today} />
      <AddChoice />

      {(error ?? postponer.error) && (
        <p role="alert" className="mini-alert">
          {error ?? postponer.error}
        </p>
      )}
      {failed && (
        <p role="alert" className="mini-alert">
          Não foi possível carregar suas tarefas. Tente de novo em instantes.
        </p>
      )}
      {loading && !failed && (
        <div role="status" aria-label="Carregando tarefas" className="mini-list" style={{ marginTop: 28 }}>
          <div className="mini-skeleton" />
          <div className="mini-skeleton" />
          <div className="mini-skeleton" />
        </div>
      )}

      {!loading && !failed && total === 0 && billCount === 0 && (
        <div className="mini-empty">
          <strong>Nada para hoje.</strong>
          Anote algo acima ou aproveite o dia livre.
        </div>
      )}

      {!loading && !failed && (
        <>
          {section("Atrasadas", overdue, { cls: "late", bills: bills.overdue })}
          {section("Hoje", todayItems, { compact: true, bills: bills.today })}
          {section("Sem data", undated)}
          {byDate.size > 0 && (
            <details className="mini-more">
              <summary>
                <ChevronIcon /> Próximos 7 dias <span className="mini-count">{upcoming.length}</span>
              </summary>
              {[...byDate.entries()].map(([date, items]) => (
                <div key={date}>
                  <p className="mini-day-label">{dayTitle(date, today)}</p>
                  <ul className="mini-list grouped">
                    {items.map((t) => (
                      <TaskItem key={t.id} task={t} today={today} onComplete={complete} onPostpone={postponeTask} compact />
                    ))}
                  </ul>
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </main>
  );
}
