"use client";

import type { IsoDate, TaskDto, TaskStatus, TaskType } from "@aj/shared";
import { useId, useState } from "react";
import { useSettings, useTasks } from "@/hooks/queries";
import { useStatusChange } from "@/hooks/use-status-change";
import { formatLongDate } from "@/lib/dates";
import { groupHistory } from "@/lib/tasks-view";

const TYPE_LABEL: Record<TaskType, string> = {
  prazo: "Prazo",
  tarefa: "Tarefa",
  audiencia: "Audiência",
};

const DONE = ["concluida"] as TaskStatus[];
const DONE_OR_CANCELLED = ["concluida", "cancelada"] as TaskStatus[];

export function HistoryView() {
  const timezone = useSettings().data?.timezone;
  if (timezone === undefined) return <p role="status">Carregando…</p>;
  return <HistoryContent timeZone={timezone} />;
}

function completionTime(task: TaskDto, timeZone: string): string | null {
  const at = task.completedAt;
  if (!at) return null;
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(at));
  } catch {
    return null;
  }
}

function HistoryContent({ timeZone }: { timeZone: string }) {
  const checkId = useId();
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const q = useTasks({ status: includeCancelled ? DONE_OR_CANCELLED : DONE });
  const { error, change } = useStatusChange();

  let groups: Array<{ day: IsoDate; tasks: TaskDto[] }> = [];
  let zoneError = false;
  try {
    groups = groupHistory(q.data ?? [], { timeZone, includeCancelled });
  } catch {
    zoneError = true; // fuso inválido nas configurações
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <input
          id={checkId}
          type="checkbox"
          checked={includeCancelled}
          onChange={(e) => setIncludeCancelled(e.target.checked)}
        />
        <label htmlFor={checkId}>Incluir canceladas</label>
      </div>
      {error && (
        <p role="alert" className="rounded border border-[var(--color-fatal)] p-2 text-sm">
          {error}
        </p>
      )}
      {(q.isError || zoneError) && <p role="alert">Não foi possível carregar o histórico.</p>}
      {q.isPending && !q.isError && <p role="status">Carregando…</p>}
      {!q.isPending && !q.isError && !zoneError && groups.length === 0 && (
        <p>{includeCancelled ? "Nenhuma tarefa concluída ou cancelada ainda." : "Nenhuma tarefa concluída ainda."}</p>
      )}
      {groups.map((g) => (
        <section key={g.day} aria-labelledby={`${checkId}-${g.day}`}>
          <h2 id={`${checkId}-${g.day}`} className="mb-2 text-lg font-semibold">
            {formatLongDate(g.day)}
          </h2>
          <ul className="flex flex-col gap-2">
            {g.tasks.map((t) => {
              const time = completionTime(t, timeZone);
              return (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-[var(--color-borda)] bg-[var(--color-superficie)] p-3"
                >
                  <span className="font-medium break-words">{t.title}</span>
                  <span className="rounded border border-[var(--color-borda)] px-1.5 text-xs">{TYPE_LABEL[t.type]}</span>
                  {t.status === "cancelada" && <span className="text-xs font-semibold">Cancelada</span>}
                  {time && (
                    <span className="font-mono text-sm">
                      <span className="sr-only">concluída às </span>
                      {time}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Reabrir ${t.title}`}
                    onClick={() => void change(t.id, "pendente")}
                    className="ml-auto min-h-10 rounded border border-[var(--color-borda)] px-3 py-1 text-sm"
                  >
                    Reabrir
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
