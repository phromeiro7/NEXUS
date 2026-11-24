"use client";

import Link from "next/link";
import { useState } from "react";
import type { IsoDate, TaskDto, TaskStatus } from "@nexus/shared";
import { FinanceNotice } from "@/components/mini/finance-notice";
import { useToast } from "@/components/mini/toast";
import { useFinance } from "@/hooks/finance";
import { useSettings, useTasks, useUpdateTask } from "@/hooks/queries";
import { useClock } from "@/hooks/use-clock";
import { usePostpone } from "@/hooks/use-postpone";
import { useStatusChange } from "@/hooks/use-status-change";
import { useToday } from "@/hooks/use-today";
import { addDays } from "@/lib/dates";
import {
  billsOfMonth,
  dueBills,
  dueLabel,
  formatBRL,
  formatBRLShort,
  hasMonthEntries,
  isOverdue,
  monthName,
  monthOf,
  monthTotals,
  type Lancamento,
} from "@/lib/finance";
import { closedLabel, dayTitle, nextUp, spokenTime, timeOnlyLabel, whenLabel } from "@/lib/mini-tasks";
import { postponeInput, postponeShortcuts, type PostponeKind } from "@/lib/postpone";
import { groupDay, groupHistory } from "@/lib/tasks-view";
import { CaptureBar } from "./capture-bar";
import { TaskDialog } from "./task-dialog";

const OPEN_STATUSES = ["pendente", "em_andamento"] as TaskStatus[];
const DONE_STATUSES = ["concluida"] as TaskStatus[];

/** Quantos dias à frente entram em "Próximos dias". */
const UPCOMING_DAYS = 7;
/** Janela das concluídas mostradas em "Ver concluídas". */
const DONE_HISTORY_DAYS = 7;
/** Sem horário, a tarefa vai para o fim do dia na ordenação ("99" > qualquer "HH:MM"). */
const NO_TIME_SORT_KEY = "99";

/** "Segunda-feira, 3 de março": a data formatada em UTC para não pular de dia pelo fuso do navegador. */
function formatDayHeading(date: IsoDate): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const formatted = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/** "2 tarefas e 2 contas para hoje"; sem nada, "Hoje está em dia." */
export function describeDaySummary(taskCount: number, billCount: number): string {
  const taskLabel = taskCount === 1 ? "1 tarefa" : `${taskCount} tarefas`;
  const billLabel = billCount === 1 ? "1 conta" : `${billCount} contas`;
  if (taskCount === 0 && billCount === 0) return "Hoje está em dia.";
  if (billCount === 0) return `${taskLabel} para hoje.`;
  if (taskCount === 0) return `${billLabel} para hoje.`;
  return `${taskLabel} e ${billLabel} para hoje.`;
}

/** Tela "Hoje" do painel: tarefas do dia (atrasadas, de hoje, sem data, próximas) e contas a pagar. */
export function TodayPanel() {
  const today = useToday();
  return (
    <>
      <CaptureBar />
      <div className="pn-body">
        {today === null ? (
          <div role="status" aria-label="Carregando">
            <h1 className="pn-h1">Hoje</h1>
            <div className="mini-skeleton" style={{ marginTop: 24 }} />
          </div>
        ) : (
          <TodayContent today={today} />
        )}
      </div>
    </>
  );
}

type TaskRowKind = "overdue" | "today" | "later" | "undated";

/** Linha de tarefa: concluir, abrir o detalhe e atalhos de adiar. O subtítulo depende da seção. */
function TaskRow({
  task,
  today,
  kind,
  onComplete,
  onPostpone,
  onOpen,
}: {
  task: TaskDto;
  today: IsoDate;
  kind: TaskRowKind;
  onComplete: (task: TaskDto) => void;
  onPostpone: (task: TaskDto, postponeKind: PostponeKind) => void;
  onOpen: (task: TaskDto) => void;
}) {
  const subtitle = describeTaskWhen(task, today, kind);
  return (
    <li className="pn-row">
      <button type="button" className="pn-circle" aria-label={`Concluir: ${task.title}`} onClick={() => onComplete(task)}>
        <span />
      </button>
      <button type="button" className="pn-row-main" aria-label={`Abrir: ${task.title}`} onClick={() => onOpen(task)}>
        <span className="pn-row-title">{task.title}</span>
        <span className={`pn-row-sub${kind === "overdue" ? " late" : ""}`}>{subtitle}</span>
      </button>
      {postponeShortcuts(task, today).map((shortcut) => (
        <button key={shortcut.kind} type="button" className="mini-btn pn-small-btn" aria-label={shortcut.ariaLabel} onClick={() => onPostpone(task, shortcut.kind)}>
          {shortcut.kind === "segunda" ? "Segunda" : shortcut.label}
        </button>
      ))}
    </li>
  );
}

/** Hoje a hora; sem data, "Sem data"; nos demais, dia e hora relativos a hoje. */
function describeTaskWhen(task: TaskDto, today: IsoDate, kind: TaskRowKind): string {
  if (kind === "today") return timeOnlyLabel(task);
  if (kind === "undated") return "Sem data";
  return whenLabel(task, today);
}

/** Ordena por data e, no mesmo dia, por horário (sem horário vai por último). */
function compareByDueDateAndTime(first: TaskDto, second: TaskDto): number {
  const firstDate = first.dueDate ?? "";
  const secondDate = second.dueDate ?? "";
  if (firstDate === secondDate) return (first.dueTime ?? NO_TIME_SORT_KEY).localeCompare(second.dueTime ?? NO_TIME_SORT_KEY);
  return firstDate < secondDate ? -1 : 1;
}

function TodayContent({ today }: { today: IsoDate }) {
  const overdueQuery = useTasks({ status: OPEN_STATUSES, to: addDays(today, -1) });
  const todayQuery = useTasks({ status: OPEN_STATUSES, from: today, to: today });
  const undatedQuery = useTasks({ status: OPEN_STATUSES, withoutDate: true });
  const upcomingQuery = useTasks({ status: OPEN_STATUSES, from: addDays(today, 1), to: addDays(today, UPCOMING_DAYS) });
  const doneQuery = useTasks({ status: DONE_STATUSES });
  const settings = useSettings();
  const { error, change } = useStatusChange();
  const updateTask = useUpdateTask();
  const postponer = usePostpone();
  const toast = useToast();
  const finance = useFinance();
  const clock = useClock(settings.data?.timezone);
  const [openTask, setOpenTask] = useState<TaskDto | null>(null);
  const [showDone, setShowDone] = useState(false);

  const overdue = groupDay(overdueQuery.data ?? [], today).overdue;
  const todayGroups = groupDay(todayQuery.data ?? [], today);
  // Ordem de hoje: prazos fatais primeiro, depois os com horário e, por fim, os só com data.
  const todayItems = [...todayGroups.fatalToday, ...todayGroups.timed, ...todayGroups.dateOnly];
  const undated = groupDay(undatedQuery.data ?? [], today).undated;
  const upcoming = [...(upcomingQuery.data ?? [])].sort(compareByDueDateAndTime);
  const hasUpcomingWithDate = upcoming.some((task) => task.dueDate);

  // "Próximos dias" não entra no carregamento/erro: é complementar e não deve segurar a tela.
  const loading = overdueQuery.isPending || todayQuery.isPending || undatedQuery.isPending;
  const failed = overdueQuery.isError || todayQuery.isError || undatedQuery.isError;
  const taskCount = overdue.length + todayItems.length;
  const nextTask = loading || failed ? null : nextUp(todayItems, clock);

  // Contas: as vencidas (de qualquer mês) e as do mês que ainda faltam pagar.
  const currentMonth = monthOf(today);
  const dueBillGroups = dueBills(finance.lancamentos, today);
  const bills: Lancamento[] = [
    ...dueBillGroups.overdue,
    ...billsOfMonth(finance.lancamentos, currentMonth).filter((bill) => bill.data >= today),
  ];
  const billsDueToday = dueBillGroups.overdue.length + dueBillGroups.today.length;
  const hasMonthEntriesForCurrentMonth = hasMonthEntries(finance.lancamentos, currentMonth);
  const totals = monthTotals(finance.lancamentos, currentMonth);

  // Histórico de concluídas precisa do fuso da conta; sem configurações (ou com fuso inválido), fica vazio.
  let doneGroups: Array<{ day: IsoDate; tasks: TaskDto[] }> = [];
  if (settings.data !== undefined) {
    try {
      const since = addDays(today, -DONE_HISTORY_DAYS);
      doneGroups = groupHistory(doneQuery.data ?? [], { timeZone: settings.data.timezone }).filter((group) => group.day >= since);
    } catch {
      doneGroups = [];
    }
  }
  const doneCount = doneGroups.reduce((total, group) => total + group.tasks.length, 0);

  function completeTask(task: TaskDto) {
    void change(task.id, "concluida");
    toast({ message: `Tarefa concluída: ${task.title}.`, undo: () => void change(task.id, "pendente") });
  }
  function postponeTask(task: TaskDto, kind: PostponeKind) {
    void postponer.postpone(task, postponeInput(task, kind, today), today);
  }
  function reopenTask(task: TaskDto) {
    void updateTask.mutateAsync({ id: task.id, input: { status: "pendente" } });
    toast({ message: `Tarefa reaberta: ${task.title}.`, undo: () => void updateTask.mutateAsync({ id: task.id, input: { status: "concluida" } }) });
  }
  function payBill(bill: Lancamento) {
    finance.marcarPaga(bill.id);
    toast({ message: `Conta paga: ${bill.descricao}.`, undo: () => finance.desmarcarPaga(bill.id) });
  }

  return (
    <div className="pn-grid2">
      <section aria-labelledby="pn-h-hoje">
        <h1 id="pn-h-hoje" className="pn-h1">
          {formatDayHeading(today)}
        </h1>
        {!loading && !failed && <p className="pn-lead">{describeDaySummary(taskCount, billsDueToday)}</p>}
        {nextTask !== null && (
          <p className="pn-sub" style={{ margin: "4px 0 0", fontSize: "1rem" }}>
            Próxima: {nextTask.title}, {spokenTime(nextTask.dueTime ?? "")}
          </p>
        )}

        <FinanceNotice />
        {(error ?? postponer.error) !== null && (
          <p role="alert" className="mini-alert">
            {error ?? postponer.error}
          </p>
        )}
        {failed && (
          <p role="alert" className="mini-alert">
            Não foi possível carregar suas tarefas. Tente de novo em instantes.
          </p>
        )}
        {loading && !failed && <div role="status" aria-label="Carregando tarefas" className="mini-skeleton" style={{ marginTop: 28 }} />}

        {!loading && !failed && (
          <>
            {overdue.length > 0 && (
              <>
                <h2 className="pn-h2">Já passaram</h2>
                <ul className="pn-list">
                  {overdue.map((task) => (
                    <TaskRow key={task.id} task={task} today={today} kind="overdue" onComplete={completeTask} onPostpone={postponeTask} onOpen={setOpenTask} />
                  ))}
                </ul>
              </>
            )}

            <h2 className="pn-h2">Hoje</h2>
            {todayItems.length > 0 ? (
              <ul className="pn-list">
                {todayItems.map((task) => (
                  <TaskRow key={task.id} task={task} today={today} kind="today" onComplete={completeTask} onPostpone={postponeTask} onOpen={setOpenTask} />
                ))}
              </ul>
            ) : (
              <p className="pn-quiet-text">Hoje está em dia. Use a barra de cima para anotar algo novo.</p>
            )}

            {undated.length > 0 && (
              <>
                <h2 className="pn-h2">Sem data</h2>
                <ul className="pn-list">
                  {undated.map((task) => (
                    <TaskRow key={task.id} task={task} today={today} kind="undated" onComplete={completeTask} onPostpone={postponeTask} onOpen={setOpenTask} />
                  ))}
                </ul>
              </>
            )}

            {hasUpcomingWithDate && (
              <>
                <h2 className="pn-h2">Próximos dias</h2>
                <ul className="pn-list">
                  {upcoming.map((task) => (
                    <TaskRow key={task.id} task={task} today={today} kind="later" onComplete={completeTask} onPostpone={postponeTask} onOpen={setOpenTask} />
                  ))}
                </ul>
              </>
            )}

            <div style={{ marginTop: 32 }}>
              <button type="button" className="mini-btn pn-small-btn" aria-expanded={showDone} aria-controls="pn-done" onClick={() => setShowDone((shown) => !shown)}>
                {showDone ? "Esconder concluídas" : `Ver concluídas (${doneCount})`}
              </button>
            </div>
            {showDone && (
              <div id="pn-done" style={{ marginTop: 12 }}>
                {doneCount === 0 ? (
                  <p className="pn-quiet-text">Nada concluído nos últimos 7 dias.</p>
                ) : (
                  doneGroups.map((group) => (
                    <section key={group.day} aria-label={dayTitle(group.day, today)}>
                      <h3 className="pn-sub" style={{ margin: "16px 0 8px", fontWeight: 700 }}>
                        {dayTitle(group.day, today)}
                      </h3>
                      <ul className="pn-list">
                        {group.tasks.map((task) => (
                          <li key={task.id} className="pn-row">
                            <span className="pn-row-main" style={{ cursor: "default" }}>
                              <span className="pn-row-title">{task.title}</span>
                              <span className="pn-row-sub">{settings.data ? (closedLabel(task, settings.data.timezone) ?? "Concluída") : "Concluída"}</span>
                            </span>
                            <button type="button" className="mini-btn pn-small-btn" aria-label={`Reabrir: ${task.title}`} onClick={() => reopenTask(task)}>
                              Reabrir
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="pn-h-contas" className="pn-col-bills">
        <h2 id="pn-h-contas" className="pn-h2">
          Contas a pagar
        </h2>
        {finance.loading ? (
          <div role="status" aria-label="Carregando contas" className="mini-skeleton" />
        ) : bills.length > 0 ? (
          <ul className="pn-list">
            {bills.map((bill) => (
              <li key={bill.id} className="pn-row">
                <span className="pn-row-main" style={{ cursor: "default" }}>
                  <span className="pn-row-title">{bill.descricao}</span>
                  <span className={`pn-row-sub${isOverdue(bill, today) ? " late" : ""}`}>{dueLabel(bill, today)}</span>
                </span>
                <span className="pn-amount">{formatBRL(bill.valorCentavos)}</span>
                <button type="button" className="mini-btn pn-small-btn" aria-label={`Paguei: ${bill.descricao}`} onClick={() => payBill(bill)}>
                  Paguei
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pn-quiet-text">Nenhuma conta em aberto neste mês.</p>
        )}

        {hasMonthEntriesForCurrentMonth && (
          <>
            <p style={{ margin: "28px 0 4px", fontSize: "1.125rem", lineHeight: 1.4 }}>
              {monthName(currentMonth)}:{" "}
              {totals.sobra >= 0 ? `sobram ${formatBRLShort(totals.sobra)} depois das contas` : `faltam ${formatBRLShort(-totals.sobra)} para fechar as contas`}.
            </p>
            <p className="pn-sub" style={{ margin: "0 0 12px" }}>
              Entrou {formatBRLShort(totals.entrou)} · Saiu {formatBRLShort(totals.saiu)} · Falta pagar {formatBRLShort(totals.aPagar)}
            </p>
            <Link href="/financas" className="mini-btn pn-small-btn">
              Ver finanças
            </Link>
          </>
        )}
      </section>

      {openTask !== null && <TaskDialog task={openTask} today={today} onClose={() => setOpenTask(null)} />}
    </div>
  );
}
