"use client";

import { nextStatuses, type TaskDto, type TaskStatus } from "@aj/shared";
import { useState } from "react";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pendente: "pendente",
  em_andamento: "em andamento",
  concluida: "concluída",
  cancelada: "cancelada",
};

const btn =
  "rounded border border-[var(--color-borda)] bg-[var(--color-superficie)] px-2 py-1 text-xs hover:underline";

/** Chip do status atual + ação direta "Concluir" + menu só com as próximas opções válidas. */
export function StatusChip({
  task,
  onChange,
}: {
  task: TaskDto;
  onChange: (status: TaskStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = nextStatuses(task.status).filter((s) => s !== "concluida");
  const canComplete = nextStatuses(task.status).includes("concluida");

  return (
    <div className="relative flex flex-wrap items-center gap-1">
      <span className="rounded bg-[var(--color-fundo)] px-2 py-1 text-xs">
        Status: {STATUS_LABEL[task.status]}
      </span>
      {canComplete && (
        <button type="button" className={btn} aria-label={`Concluir ${task.title}`} onClick={() => onChange("concluida")}>
          Concluir
        </button>
      )}
      <button
        type="button"
        className={btn}
        aria-label={`Alterar status de ${task.title}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Alterar
      </button>
      {open && (
        <ul className="flex w-full flex-wrap gap-1">
          {options.map((s) => (
            <li key={s}>
              <button
                type="button"
                className={btn}
                aria-label={`Marcar ${task.title} como ${STATUS_LABEL[s]}`}
                onClick={() => {
                  setOpen(false);
                  onChange(s);
                }}
              >
                {s === "pendente" && task.status !== "pendente" ? "Reabrir como pendente" : STATUS_LABEL[s]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
