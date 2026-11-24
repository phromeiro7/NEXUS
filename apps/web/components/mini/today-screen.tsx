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

const OPEN_STATUSES = ["pendente", "em_andamento"] as TaskStatus[];
/** Quantos dias à frente entram na seção recolhida "Próximos 7 dias". */
const UPCOMING_DAYS = 7;
/** Horário fictício que joga tarefas sem hora para o fim do dia na ordenação. */
const NO_TIME_SORT_KEY = "99";

/** Ex.: "segunda-feira, 3 de março". Formata em UTC porque a data já é o dia local (sem hora). */
function dayHeading(date: IsoDate): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/** Ordena por data e, no mesmo dia, por horário (sem horário vai para o fim). */
function compareByDueDateAndTime(first: TaskDto, second: TaskDto): number {
  const firstDate = first.dueDate ?? "";
  const secondDate = second.dueDate ?? "";
  if (firstDate === secondDate) {
    return (first.dueTime ?? NO_TIME_SORT_KEY).localeCompare(second.dueTime ?? NO_TIME_SORT_KEY);
  }
  return firstDate < secondDate ? -1 : 1;
}

/** Tela "Hoje" do Mini App (/mini): atrasadas, o dia, sem data, contas vencendo e os próximos dias. */
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
  const yearMonth = monthOf(today);
  if (!hasMonthEntries(list, yearMonth)) return null;
  const { sobra } = monthTotals(list, yearMonth);
  return (
    <Link href="/mini/financas" className="mini-monthline">
      <span>
        {monthName(yearMonth)}: {sobra >= 0 ? `sobram ${formatBRLShort(sobra)} depois das contas` : `faltam ${formatBRLShort(-sobra)} para fechar as contas`}
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
        onClick={() => setOpen((wasOpen) => !wasOpen)}
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
              // A captura de tarefa já está na tela: em vez de navegar, rola até o campo e foca nele.
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
  const overdueQuery = useTasks({ status: OPEN_STATUSES, to: addDays(today, -1) });
  const todayQuery = useTasks({ status: OPEN_STATUSES, from: today, to: today });
  const undatedQuery = useTasks({ status: OPEN_STATUSES, withoutDate: true });
  const upcomingQuery = useTasks({ status: OPEN_STATUSES, from: addDays(today, 1), to: addDays(today, UPCOMING_DAYS) });
  const { error, change } = useStatusChange();
  const postponer = usePostpone();
  const toast = useToast();
  const clock = useClock(useSettings().data?.timezone);
  const finance = useFinance();
  const bills = dueBills(finance.lancamentos, today);
  const billCount = bills.overdue.length + bills.today.length;

  const overdue = groupDay(overdueQuery.data ?? [], today).overdue;
  const todayGroups = groupDay(todayQuery.data ?? [], today);
  // Ordem do dia: prazos fatais primeiro, depois as com horário e por fim as só com data.
  const todayItems = [...todayGroups.fatalToday, ...todayGroups.timed, ...todayGroups.dateOnly];
  const undated = groupDay(undatedQuery.data ?? [], today).undated;
  const upcoming = [...(upcomingQuery.data ?? [])].sort(compareByDueDateAndTime);
  const upcomingByDate = new Map<IsoDate, TaskDto[]>();
  for (const task of upcoming) {
    if (task.dueDate) upcomingByDate.set(task.dueDate, [...(upcomingByDate.get(task.dueDate) ?? []), task]);
  }

  // Os próximos dias ficam recolhidos e não bloqueiam a tela: só as três consultas principais contam.
  const loading = overdueQuery.isPending || todayQuery.isPending || undatedQuery.isPending;
  const failed = overdueQuery.isError || todayQuery.isError || undatedQuery.isError;
  const total = overdue.length + todayItems.length;
  const nextTask = loading || failed ? null : nextUp(todayItems, clock);

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

  /** Seção de tarefas (e, opcionalmente, contas) com título e contagem; some quando está vazia. */
  const renderSection = (
    title: string,
    items: TaskDto[],
    options: { className?: string; compact?: boolean; bills?: Lancamento[] } = {},
  ) => {
    const sectionBills = options.bills ?? [];
    const itemCount = items.length + sectionBills.length;
    return (
      itemCount > 0 && (
        <section className={`mini-section ${options.className ?? ""}`} aria-labelledby={`h-${title}`}>
          <h2 id={`h-${title}`}>
            {title} <span className="mini-count">{itemCount}</span>
          </h2>
          <ul className="mini-list grouped">
            {items.map((task, index) => (
              <TaskItem key={task.id} task={task} today={today} onComplete={complete} onPostpone={postponeTask} index={index} compact={options.compact} />
            ))}
            {/* As contas continuam a animação escalonada depois das tarefas. */}
            {sectionBills.map((bill, index) => (
              <BillItem key={bill.id} bill={bill} today={today} onPay={payBill} index={items.length + index} />
            ))}
          </ul>
        </section>
      )
    );
  };

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
        {nextTask && (
          <Link href={`/mini/tarefa/${nextTask.id}`} className="mini-next">
            <span className="mini-dot" aria-hidden="true" />
            <span className="mini-next-text">
              <small>Próxima</small>
              <strong>{nextTask.title}</strong>
            </span>
            <span className="mini-next-time">{spokenTime(nextTask.dueTime ?? "")}</span>
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
          {renderSection("Atrasadas", overdue, { className: "late", bills: bills.overdue })}
          {renderSection("Hoje", todayItems, { compact: true, bills: bills.today })}
          {renderSection("Sem data", undated)}
          {upcomingByDate.size > 0 && (
            <details className="mini-more">
              <summary>
                <ChevronIcon /> Próximos 7 dias <span className="mini-count">{upcoming.length}</span>
              </summary>
              {[...upcomingByDate.entries()].map(([date, items]) => (
                <div key={date}>
                  <p className="mini-day-label">{dayTitle(date, today)}</p>
                  <ul className="mini-list grouped">
                    {items.map((task) => (
                      <TaskItem key={task.id} task={task} today={today} onComplete={complete} onPostpone={postponeTask} compact />
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
