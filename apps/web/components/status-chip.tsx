"use client";

import { nextStatuses, type TaskDto, type TaskStatus } from "@aj/shared";
import { useEffect, useId, useRef, useState } from "react";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pendente: "pendente",
  em_andamento: "em andamento",
  concluida: "concluída",
  cancelada: "cancelada",
};

const btn =
  "min-h-10 rounded border border-[var(--color-borda)] bg-[var(--color-superficie)] px-3 py-1 text-xs hover:underline";

/** Chip do status atual + ação direta "Concluir" + menu só com as próximas opções válidas. */
export function StatusChip({
  task,
  onChange,
}: {
  task: TaskDto;
  onChange: (status: TaskStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const options = nextStatuses(task.status).filter((s) => s !== "concluida");
  const canComplete = nextStatuses(task.status).includes("concluida");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    const onPointer = (e: Event) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex flex-wrap items-center gap-1">
      <span className="rounded bg-[var(--color-fundo)] px-2 py-1 text-xs">
        Status: {STATUS_LABEL[task.status]}
      </span>
      {canComplete && (
        <button type="button" className={btn} aria-label={`Concluir ${task.title}`} onClick={() => onChange("concluida")}>
          Concluir
        </button>
      )}
      <button
        ref={toggleRef}
        type="button"
        className={btn}
        aria-label={`Alterar status de ${task.title}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        Alterar
      </button>
      {open && (
        <ul id={menuId} className="flex w-full flex-wrap gap-1">
          {options.map((s) => {
            const visible = s === "pendente" && task.status !== "pendente" ? "Reabrir como pendente" : STATUS_LABEL[s];
            return (
              <li key={s}>
                <button
                  type="button"
                  className={btn}
                  // O nome acessível começa pelo texto visível (WCAG 2.5.3) e acrescenta a tarefa.
                  aria-label={`${visible} (${task.title})`}
                  onClick={() => {
                    setOpen(false);
                    onChange(s);
                  }}
                >
                  {visible}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
