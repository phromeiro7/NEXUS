"use client";

import type { IsoDate, TaskDto, TaskStatus, TaskType } from "@aj/shared";
import { urgencyLabel } from "@/lib/tasks-view";
import { StatusChip } from "./status-chip";

const TYPE_LABEL: Record<TaskType, string> = {
  prazo: "Prazo",
  tarefa: "Tarefa",
  audiencia: "Audiência",
};

export function TaskRow({
  task,
  today,
  onChange,
}: {
  task: TaskDto;
  today: IsoDate;
  onChange: (status: TaskStatus) => void;
}) {
  const overdue = task.dueDate !== null && task.dueDate < today && task.status !== "concluida";
  return (
    <li
      className={`flex flex-col gap-1 rounded border bg-[var(--color-superficie)] p-3 ${
        task.fatal ? "border-l-4 border-[var(--color-fatal)]" : "border-[var(--color-borda)]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium break-words">{task.title}</span>
        <span className="rounded border border-[var(--color-borda)] px-1.5 text-xs">{TYPE_LABEL[task.type]}</span>
        {task.fatal && (
          <span className="rounded bg-[var(--color-fatal)] px-1.5 text-xs font-semibold text-[var(--color-superficie)]">
            Fatal
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 text-sm">
        {task.dueTime !== null ? (
          <span className="font-mono font-semibold">{task.dueTime}</span>
        ) : (
          <span className="italic text-[var(--color-texto)] opacity-80">Dia inteiro</span>
        )}
        <span className={overdue ? "font-semibold text-[var(--color-atraso)]" : undefined}>
          {urgencyLabel(task, today)}
        </span>
      </div>
      <StatusChip task={task} onChange={onChange} />
    </li>
  );
}
