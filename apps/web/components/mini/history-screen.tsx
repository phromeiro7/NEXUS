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
const DAYS_PER_PAGE = 7;
const FILTERS: Array<{ key: HistoryFilter; label: string }> = [
  { key: "tudo", label: "Tudo" },
  { key: "tarefas", label: "Tarefas" },
  { key: "gastos", label: "Gastos" },
  { key: "entradas", label: "Entradas" },
];

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
  const [all, setAll] = useState(false);
  const [filter, setFilter] = useState<HistoryFilter>("tudo");
  const [pages, setPages] = useState(1);
  const q = useTasks({ status: all ? DONE_OR_CANCELLED : DONE });
  const { error, change } = useStatusChange();
  const finance = useFinance();
  const toast = useToast();
  const withTasks = filter === "tudo" || filter === "tarefas";

  let taskGroups: Array<{ day: IsoDate; tasks: TaskDto[] }> = [];
  let zoneError = false;
  try {
    taskGroups = groupHistory(q.data ?? [], { timeZone, includeCancelled: all });
  } catch {
    zoneError = true;
  }
  const finGroups = groupByDay(historyEntries(finance.lancamentos, filter));
  // Tarefas e lançamentos do mesmo dia ficam sob o mesmo título, do dia mais recente ao mais antigo.
  const merged = new Map<IsoDate, { day: IsoDate; tasks: TaskDto[]; items: Lancamento[] }>();
  if (withTasks) for (const g of taskGroups) merged.set(g.day, { day: g.day, tasks: g.tasks, items: [] });
  for (const g of finGroups) merged.set(g.day, { day: g.day, tasks: merged.get(g.day)?.tasks ?? [], items: g.items });
  const groups = [...merged.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));

  const weekStart = addDays(today, -6);
  const doneThisWeek = taskGroups
    .filter((g) => g.day >= weekStart && g.day <= today)
    .reduce((n, g) => n + g.tasks.filter((t) => t.status === "concluida").length, 0);
  const visible = groups.slice(0, pages * DAYS_PER_PAGE);
  const loading = withTasks && q.isPending && !q.isError;
  const failed = withTasks && (q.isError || zoneError);
  const shownTotal = netOf(visible.flatMap((g) => g.items));

  function reopen(task: TaskDto) {
    const was = task.status;
    void change(task.id, "pendente");
    toast({ message: `Tarefa reaberta: ${task.title}.`, undo: () => void change(task.id, was) });
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
        {!loading && !failed && withTasks && (
          <p className="mini-hero-summary">
            {doneThisWeek === 0
              ? "Nenhuma concluída nos últimos 7 dias"
              : `${doneThisWeek} ${doneThisWeek === 1 ? "concluída" : "concluídas"} nos últimos 7 dias`}
          </p>
        )}
      </header>

      <div role="group" aria-label="Filtrar" className="mini-chips mini-filter">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="mini-chip"
            aria-pressed={filter === f.key}
            onClick={() => {
              setFilter(f.key);
              setPages(1);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      {withTasks && (
        <div role="group" aria-label="Mostrar" className="mini-chips mini-filter" style={{ marginTop: 8 }}>
          <button type="button" className="mini-chip" aria-pressed={!all} onClick={() => { setAll(false); setPages(1); }}>
            Concluídas
          </button>
          <button type="button" className="mini-chip" aria-pressed={all} onClick={() => { setAll(true); setPages(1); }}>
            Com canceladas
          </button>
        </div>
      )}
      {!loading && !failed && (filter === "gastos" || filter === "entradas") && visible.length > 0 && (
        <p className="mini-day-total" aria-live="polite">
          {filter === "gastos" ? "Gastos" : "Entradas"} nos dias exibidos: <b>{formatBRL(Math.abs(shownTotal))}</b>
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
          {filter === "gastos" || filter === "entradas"
            ? "Quando você anotar um lançamento já pago ou recebido, ele aparece aqui."
            : "Quando você concluir uma tarefa ou anotar um lançamento, aparece neste histórico."}
        </div>
      )}

      {!loading &&
        !failed &&
        visible.map((g) => (
          <section key={g.day} className="mini-section" aria-labelledby={`hd-${g.day}`}>
            <h2 id={`hd-${g.day}`}>
              {dayTitle(g.day, today)} <span className="mini-count">{g.tasks.length + g.items.length}</span>
            </h2>
            <ul className="mini-list grouped">
              {g.items.map((l) => (
                <li key={l.id} className="mini-item done">
                  <span className="mini-done-mark" aria-hidden="true">
                    <span>
                      <CheckIcon />
                    </span>
                  </span>
                  <div className="mini-body">
                    <div>
                      <strong>{l.descricao}</strong>
                      <span className="mini-meta">
                        <span>{l.categoria ? `${tipoLabel(l)} · ${l.categoria}` : tipoLabel(l)}</span>
                      </span>
                    </div>
                    <span className={`mini-amount${l.tipo === "entrada" ? " in" : ""}`} style={{ paddingRight: 0 }}>
                      {l.tipo === "entrada" ? "+ " : "− "}
                      {formatBRL(l.valorCentavos)}
                    </span>
                  </div>
                  <button type="button" className="mini-reopen" aria-label={`Excluir ${l.descricao}`} onClick={() => removeEntry(l)}>
                    <TrashIcon />
                    <span>Excluir</span>
                  </button>
                </li>
              ))}
              {g.tasks.map((t) => (
                <li key={t.id} className={`mini-item done${t.status === "cancelada" ? " cancelled" : ""}`}>
                  <span className="mini-done-mark" aria-hidden="true">
                    <span>{t.status === "concluida" && <CheckIcon />}</span>
                  </span>
                  <Link href={`/mini/tarefa/${t.id}`} className="mini-body" aria-label={`Abrir ${t.title}`}>
                    <div>
                      <strong>{t.title}</strong>
                      <span className="mini-meta">
                        <span>{closedLabel(t, timeZone) ?? (t.status === "cancelada" ? "Cancelada" : "Concluída")}</span>
                      </span>
                    </div>
                    <ChevronIcon />
                  </Link>
                  <button type="button" className="mini-reopen" aria-label={`Reabrir ${t.title}`} onClick={() => reopen(t)}>
                    <UndoIcon />
                    <span>Reabrir</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

      {!loading && !failed && groups.length > visible.length && (
        <button type="button" className="mini-btn" style={{ width: "100%", marginTop: 24 }} onClick={() => setPages((n) => n + 1)}>
          Ver dias anteriores
        </button>
      )}
    </main>
  );
}
