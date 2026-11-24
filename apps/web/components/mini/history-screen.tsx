"use client";

import Link from "next/link";
import { useState } from "react";
import type { IsoDate, TaskDto, TaskStatus } from "@nexus/shared";
import { useFinance } from "@/hooks/finance";
import { FinanceNotice } from "./finance-notice";
import { useSettings, useTasks } from "@/hooks/queries";
import { useStatusChange } from "@/hooks/use-status-change";
import { useToday } from "@/hooks/use-today";
import { addDays } from "@/lib/dates";
import { formatBRL, groupByDay, historyEntries, netOf, tipoLabel, type HistoryFilter, type Lancamento } from "@/lib/finance";
import { closedLabel, dayTitle } from "@/lib/mini-tasks";
import { groupHistory } from "@/lib/tasks-view";
import { CheckIcon, ChevronIcon, TrashIcon, UndoIcon } from "./icons";
import { useToast } from "./toast";

const DONE = ["concluida"] as TaskStatus[];
const DONE_OR_CANCELLED = ["concluida", "cancelada"] as TaskStatus[];
/** Quantos dias o histórico mostra por vez; "Ver dias anteriores" carrega mais uma página. */
const DAYS_PER_PAGE = 7;
/** Janela do resumo "concluídas nos últimos 7 dias", contando hoje. */
const SUMMARY_WINDOW_DAYS = 7;
const FILTERS: Array<{ key: HistoryFilter; label: string }> = [
  { key: "tudo", label: "Tudo" },
  { key: "tarefas", label: "Tarefas" },
  { key: "gastos", label: "Gastos" },
  { key: "entradas", label: "Entradas" },
];

/** Tela "Histórico" do Mini App (/mini/historico): tarefas concluídas e lançamentos já pagos, por dia. */
export function HistoryScreen() {
  const timezone = useSettings().data?.timezone;
  const today = useToday();
  if (timezone === undefined || today === null) {
    return (
      <div role="status" aria-label="Carregando">
        <div className="mini-hero">
          <h1>Histórico</h1>
        </div>
        <div className="mini-list" style={{ marginTop: 24 }}>
          <div className="mini-skeleton" />
          <div className="mini-skeleton" />
        </div>
      </div>
    );
  }
  return <HistoryContent timeZone={timezone} today={today} />;
}

function HistoryContent({ timeZone, today }: { timeZone: string; today: IsoDate }) {
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [filter, setFilter] = useState<HistoryFilter>("tudo");
  const [pageCount, setPageCount] = useState(1);
  const tasksQuery = useTasks({ status: includeCancelled ? DONE_OR_CANCELLED : DONE });
  const { error, change } = useStatusChange();
  const finance = useFinance();
  const toast = useToast();
  const showsTasks = filter === "tudo" || filter === "tarefas";
  const showsOnlyMoney = filter === "gastos" || filter === "entradas";

  // Um fuso inválido nas configurações faz o agrupamento lançar: vira erro na tela em vez de quebrar.
  let taskGroups: Array<{ day: IsoDate; tasks: TaskDto[] }> = [];
  let timeZoneError = false;
  try {
    taskGroups = groupHistory(tasksQuery.data ?? [], { timeZone, includeCancelled });
  } catch {
    timeZoneError = true;
  }
  const financeGroups = groupByDay(historyEntries(finance.lancamentos, filter));
  // Tarefas e lançamentos do mesmo dia ficam sob o mesmo título, do dia mais recente ao mais antigo.
  const groupsByDay = new Map<IsoDate, { day: IsoDate; tasks: TaskDto[]; items: Lancamento[] }>();
  if (showsTasks) {
    for (const group of taskGroups) groupsByDay.set(group.day, { day: group.day, tasks: group.tasks, items: [] });
  }
  for (const group of financeGroups) {
    groupsByDay.set(group.day, { day: group.day, tasks: groupsByDay.get(group.day)?.tasks ?? [], items: group.items });
  }
  const groups = [...groupsByDay.values()].sort((first, second) =>
    first.day < second.day ? 1 : first.day > second.day ? -1 : 0,
  );

  const summaryWindowStart = addDays(today, -(SUMMARY_WINDOW_DAYS - 1));
  const doneThisWeek = taskGroups
    .filter((group) => group.day >= summaryWindowStart && group.day <= today)
    .reduce((count, group) => count + group.tasks.filter((task) => task.status === "concluida").length, 0);
  const visibleGroups = groups.slice(0, pageCount * DAYS_PER_PAGE);
  const loading = showsTasks && tasksQuery.isPending && !tasksQuery.isError;
  const failed = showsTasks && (tasksQuery.isError || timeZoneError);
  const visibleMoneyTotal = netOf(visibleGroups.flatMap((group) => group.items));

  /** Trocar de filtro ou de modo volta para a primeira página. */
  function selectFilter(nextFilter: HistoryFilter) {
    setFilter(nextFilter);
    setPageCount(1);
  }

  function selectIncludeCancelled(nextValue: boolean) {
    setIncludeCancelled(nextValue);
    setPageCount(1);
  }

  function reopen(task: TaskDto) {
    const previousStatus = task.status;
    void change(task.id, "pendente");
    toast({ message: `Tarefa reaberta: ${task.title}.`, undo: () => void change(task.id, previousStatus) });
  }

  function removeEntry(item: Lancamento) {
    finance.remove(item.id);
    toast({ message: `Lançamento excluído: ${item.descricao}.`, undo: () => finance.restore(item) });
  }

  return (
    <main>
      <header className="mini-hero">
        <h1>Histórico</h1>
        <p className="mini-hero-date">O que você já resolveu</p>
        {!loading && !failed && showsTasks && (
          <p className="mini-hero-summary">
            {doneThisWeek === 0
              ? "Nenhuma concluída nos últimos 7 dias"
              : `${doneThisWeek} ${doneThisWeek === 1 ? "concluída" : "concluídas"} nos últimos 7 dias`}
          </p>
        )}
      </header>

      <div role="group" aria-label="Filtrar" className="mini-chips mini-filter">
        {FILTERS.map((option) => (
          <button
            key={option.key}
            type="button"
            className="mini-chip"
            aria-pressed={filter === option.key}
            onClick={() => selectFilter(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {showsTasks && (
        <div role="group" aria-label="Mostrar" className="mini-chips mini-filter" style={{ marginTop: 8 }}>
          <button type="button" className="mini-chip" aria-pressed={!includeCancelled} onClick={() => selectIncludeCancelled(false)}>
            Concluídas
          </button>
          <button type="button" className="mini-chip" aria-pressed={includeCancelled} onClick={() => selectIncludeCancelled(true)}>
            Com canceladas
          </button>
        </div>
      )}
      {!loading && !failed && showsOnlyMoney && visibleGroups.length > 0 && (
        <p className="mini-day-total" aria-live="polite">
          {filter === "gastos" ? "Gastos" : "Entradas"} nos dias exibidos: <b>{formatBRL(Math.abs(visibleMoneyTotal))}</b>
        </p>
      )}

      <FinanceNotice />

      {error && (
        <p role="alert" className="mini-alert">
          {error}
        </p>
      )}
      {failed && (
        <p role="alert" className="mini-alert">
          Não foi possível carregar o histórico. Tente de novo em instantes.
        </p>
      )}
      {loading && (
        <div role="status" aria-label="Carregando histórico" className="mini-list" style={{ marginTop: 28 }}>
          <div className="mini-skeleton" />
          <div className="mini-skeleton" />
        </div>
      )}
      {!loading && !failed && groups.length === 0 && (
        <div className="mini-empty">
          <strong>Ainda não há nada por aqui.</strong>
          {showsOnlyMoney
            ? "Quando você anotar um lançamento já pago ou recebido, ele aparece aqui."
            : "Quando você concluir uma tarefa ou anotar um lançamento, aparece neste histórico."}
        </div>
      )}

      {!loading &&
        !failed &&
        visibleGroups.map((group) => (
          <section key={group.day} className="mini-section" aria-labelledby={`hd-${group.day}`}>
            <h2 id={`hd-${group.day}`}>
              {dayTitle(group.day, today)} <span className="mini-count">{group.tasks.length + group.items.length}</span>
            </h2>
            <ul className="mini-list grouped">
              {group.items.map((entry) => (
                <li key={entry.id} className="mini-item done">
                  <span className="mini-done-mark" aria-hidden="true">
                    <span>
                      <CheckIcon />
                    </span>
                  </span>
                  <div className="mini-body">
                    <div>
                      <strong>{entry.descricao}</strong>
                      <span className="mini-meta">
                        <span>{entry.categoria ? `${tipoLabel(entry)} · ${entry.categoria}` : tipoLabel(entry)}</span>
                      </span>
                    </div>
                    <span className={`mini-amount${entry.tipo === "entrada" ? " in" : ""}`} style={{ paddingRight: 0 }}>
                      {entry.tipo === "entrada" ? "+ " : "− "}
                      {formatBRL(entry.valorCentavos)}
                    </span>
                  </div>
                  <button type="button" className="mini-reopen" aria-label={`Excluir ${entry.descricao}`} onClick={() => removeEntry(entry)}>
                    <TrashIcon />
                    <span>Excluir</span>
                  </button>
                </li>
              ))}
              {group.tasks.map((task) => (
                <li key={task.id} className={`mini-item done${task.status === "cancelada" ? " cancelled" : ""}`}>
                  <span className="mini-done-mark" aria-hidden="true">
                    <span>{task.status === "concluida" && <CheckIcon />}</span>
                  </span>
                  <Link href={`/mini/tarefa/${task.id}`} className="mini-body" aria-label={`Abrir ${task.title}`}>
                    <div>
                      <strong>{task.title}</strong>
                      <span className="mini-meta">
                        <span>{closedLabel(task, timeZone) ?? (task.status === "cancelada" ? "Cancelada" : "Concluída")}</span>
                      </span>
                    </div>
                    <ChevronIcon />
                  </Link>
                  <button type="button" className="mini-reopen" aria-label={`Reabrir ${task.title}`} onClick={() => reopen(task)}>
                    <UndoIcon />
                    <span>Reabrir</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

      {!loading && !failed && groups.length > visibleGroups.length && (
        <button type="button" className="mini-btn" style={{ width: "100%", marginTop: 24 }} onClick={() => setPageCount((count) => count + 1)}>
          Ver dias anteriores
        </button>
      )}
    </main>
  );
}
