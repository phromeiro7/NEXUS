"use client";

import Link from "next/link";
import { useState } from "react";
import type { IsoDate, TaskDto, TaskStatus } from "@nexus/shared";
import { FinanceNotice } from "@/components/mini/finance-notice";
import { useToast } from "@/components/mini/toast";
import { useFinance } from "@/hooks/finance";
import { useSettings, useTasks, useUpdateTask } from "@/hooks/queries";
import { useClock } from "@/hooks/use-clock";
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
import { groupDay, groupHistory } from "@/lib/tasks-view";
import { CaptureBar } from "./capture-bar";
import { TaskDialog } from "./task-dialog";

const OPEN = ["pendente", "em_andamento"] as TaskStatus[];
const DONE = ["concluida"] as TaskStatus[];

function dayHeading(date: IsoDate): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const text = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(Date.UTC(y, m - 1, d)));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "2 tarefas e 2 contas para hoje"; sem nada, "Hoje está em dia." */
export function daySentence(tasks: number, bills: number): string {
  const t = tasks === 1 ? "1 tarefa" : `${tasks} tarefas`;
  const b = bills === 1 ? "1 conta" : `${bills} contas`;
  if (tasks === 0 && bills === 0) return "Hoje está em dia.";
  if (bills === 0) return `${t} para hoje.`;
  if (tasks === 0) return `${b} para hoje.`;
  return `${t} e ${b} para hoje.`;
}

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

function TaskRow({ task, today, kind, onComplete, onOpen }: { task: TaskDto; today: IsoDate; kind: "overdue" | "today" | "later" | "undated"; onComplete: (t: TaskDto) => void; onOpen: (t: TaskDto) => void }) {
  const sub = kind === "today" ? timeOnlyLabel(task) : kind === "undated" ? "Sem data" : whenLabel(task, today);
  return (
    <li className="pn-row">
      <button type="button" className="pn-circle" aria-label={`Concluir: ${task.title}`} onClick={() => onComplete(task)}>
        <span />
      </button>
      <button type="button" className="pn-row-main" aria-label={`Abrir: ${task.title}`} onClick={() => onOpen(task)}>
        <span className="pn-row-title">{task.title}</span>
        <span className={`pn-row-sub${kind === "overdue" ? " late" : ""}`}>{sub}</span>
      </button>
    </li>
  );
}

function TodayContent({ today }: { today: IsoDate }) {
  const overdueQ = useTasks({ status: OPEN, to: addDays(today, -1) });
  const todayQ = useTasks({ status: OPEN, from: today, to: today });
  const undatedQ = useTasks({ status: OPEN, withoutDate: true });
  const laterQ = useTasks({ status: OPEN, from: addDays(today, 1), to: addDays(today, 7) });
  const doneQ = useTasks({ status: DONE });
  const settings = useSettings();
  const { error, change } = useStatusChange();
  const update = useUpdateTask();
  const toast = useToast();
  const finance = useFinance();
  const clock = useClock(settings.data?.timezone);
  const [openTask, setOpenTask] = useState<TaskDto | null>(null);
  const [showDone, setShowDone] = useState(false);

  const overdue = groupDay(overdueQ.data ?? [], today).overdue;
  const day = groupDay(todayQ.data ?? [], today);
  const todayItems = [...day.fatalToday, ...day.timed, ...day.dateOnly];
  const undated = groupDay(undatedQ.data ?? [], today).undated;
  const later = [...(laterQ.data ?? [])].sort((a, b) =>
    (a.dueDate ?? "") === (b.dueDate ?? "") ? (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99") : (a.dueDate ?? "") < (b.dueDate ?? "") ? -1 : 1,
  );
  const laterByDate = new Map<IsoDate, TaskDto[]>();
  for (const t of later) if (t.dueDate) laterByDate.set(t.dueDate, [...(laterByDate.get(t.dueDate) ?? []), t]);

  const loading = overdueQ.isPending || todayQ.isPending || undatedQ.isPending;
  const failed = overdueQ.isError || todayQ.isError || undatedQ.isError;
  const taskCount = overdue.length + todayItems.length;
  const next = loading || failed ? null : nextUp(todayItems, clock);

  // Contas: as vencidas (de qualquer mês) e as do mês que ainda faltam pagar.
  const ym = monthOf(today);
  const due = dueBills(finance.lancamentos, today);
  const bills: Lancamento[] = [...due.overdue, ...billsOfMonth(finance.lancamentos, ym).filter((b) => b.data >= today)];
  const billsToday = due.overdue.length + due.today.length;
  const hasMonth = hasMonthEntries(finance.lancamentos, ym);
  const totals = monthTotals(finance.lancamentos, ym);

  let doneGroups: Array<{ day: IsoDate; tasks: TaskDto[] }> = [];
  if (settings.data !== undefined) {
    try {
      const since = addDays(today, -7);
      doneGroups = groupHistory(doneQ.data ?? [], { timeZone: settings.data.timezone }).filter((g) => g.day >= since);
    } catch {
      doneGroups = [];
    }
  }
  const doneCount = doneGroups.reduce((n, g) => n + g.tasks.length, 0);

  function complete(task: TaskDto) {
    void change(task.id, "concluida");
    toast({ message: `Tarefa concluída: ${task.title}.`, undo: () => void change(task.id, "pendente") });
  }
  function reopen(task: TaskDto) {
    void update.mutateAsync({ id: task.id, input: { status: "pendente" } });
    toast({ message: `Tarefa reaberta: ${task.title}.`, undo: () => void update.mutateAsync({ id: task.id, input: { status: "concluida" } }) });
  }
  function pay(bill: Lancamento) {
    finance.marcarPaga(bill.id);
    toast({ message: `Conta paga: ${bill.descricao}.`, undo: () => finance.desmarcarPaga(bill.id) });
  }

  return (
    <div className="pn-grid2">
      <section aria-labelledby="pn-h-hoje">
        <h1 id="pn-h-hoje" className="pn-h1">
          {dayHeading(today)}
        </h1>
        {!loading && !failed && <p className="pn-lead">{daySentence(taskCount, billsToday)}</p>}
        {next !== null && (
          <p className="pn-sub" style={{ margin: "4px 0 0", fontSize: "1rem" }}>
            Próxima: {next.title}, {spokenTime(next.dueTime ?? "")}
          </p>
        )}

        <FinanceNotice />
        {error !== null && (
          <p role="alert" className="mini-alert">
            {error}
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
                  {overdue.map((t) => (
                    <TaskRow key={t.id} task={t} today={today} kind="overdue" onComplete={complete} onOpen={setOpenTask} />
                  ))}
                </ul>
              </>
            )}

            <h2 className="pn-h2">Hoje</h2>
            {todayItems.length > 0 ? (
              <ul className="pn-list">
                {todayItems.map((t) => (
                  <TaskRow key={t.id} task={t} today={today} kind="today" onComplete={complete} onOpen={setOpenTask} />
                ))}
              </ul>
            ) : (
              <p className="pn-quiet-text">Hoje está em dia. Use a barra de cima para anotar algo novo.</p>
            )}

            {undated.length > 0 && (
              <>
                <h2 className="pn-h2">Sem data</h2>
                <ul className="pn-list">
                  {undated.map((t) => (
                    <TaskRow key={t.id} task={t} today={today} kind="undated" onComplete={complete} onOpen={setOpenTask} />
                  ))}
                </ul>
              </>
            )}

            {laterByDate.size > 0 && (
              <>
                <h2 className="pn-h2">Próximos dias</h2>
                <ul className="pn-list">
                  {later.map((t) => (
                    <TaskRow key={t.id} task={t} today={today} kind="later" onComplete={complete} onOpen={setOpenTask} />
                  ))}
                </ul>
              </>
            )}

            <div style={{ marginTop: 32 }}>
              <button type="button" className="mini-btn pn-small-btn" aria-expanded={showDone} aria-controls="pn-done" onClick={() => setShowDone((v) => !v)}>
                {showDone ? "Esconder concluídas" : `Ver concluídas (${doneCount})`}
              </button>
            </div>
            {showDone && (
              <div id="pn-done" style={{ marginTop: 12 }}>
                {doneCount === 0 ? (
                  <p className="pn-quiet-text">Nada concluído nos últimos 7 dias.</p>
                ) : (
                  doneGroups.map((g) => (
                    <section key={g.day} aria-label={dayTitle(g.day, today)}>
                      <h3 className="pn-sub" style={{ margin: "16px 0 8px", fontWeight: 700 }}>
                        {dayTitle(g.day, today)}
                      </h3>
                      <ul className="pn-list">
                        {g.tasks.map((t) => (
                          <li key={t.id} className="pn-row">
                            <span className="pn-row-main" style={{ cursor: "default" }}>
                              <span className="pn-row-title">{t.title}</span>
                              <span className="pn-row-sub">{settings.data ? (closedLabel(t, settings.data.timezone) ?? "Concluída") : "Concluída"}</span>
                            </span>
                            <button type="button" className="mini-btn pn-small-btn" aria-label={`Reabrir: ${t.title}`} onClick={() => reopen(t)}>
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
            {bills.map((b) => (
              <li key={b.id} className="pn-row">
                <span className="pn-row-main" style={{ cursor: "default" }}>
                  <span className="pn-row-title">{b.descricao}</span>
                  <span className={`pn-row-sub${isOverdue(b, today) ? " late" : ""}`}>{dueLabel(b, today)}</span>
                </span>
                <span className="pn-amount">{formatBRL(b.valorCentavos)}</span>
                <button type="button" className="mini-btn pn-small-btn" aria-label={`Paguei: ${b.descricao}`} onClick={() => pay(b)}>
                  Paguei
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pn-quiet-text">Nenhuma conta em aberto neste mês.</p>
        )}

        {hasMonth && (
          <>
            <p style={{ margin: "28px 0 4px", fontSize: "1.125rem", lineHeight: 1.4 }}>
              {monthName(ym)}:{" "}
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
