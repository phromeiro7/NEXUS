"use client";

import Link from "next/link";
import type { IsoDate, TaskDto } from "@aj/shared";
import { timeOnlyLabel, whenLabel } from "@/lib/mini-tasks";
import { CheckIcon, ChevronIcon, ClockIcon } from "./icons";

const TYPE_TAG: Record<string, string> = { prazo: "Prazo", audiencia: "Audiência" };

export function TaskItem({
  task,
  today,
  onComplete,
  index = 0,
  compact = false,
}: {
  task: TaskDto;
  today: IsoDate;
  onComplete: (task: TaskDto) => void;
  index?: number;
  /** Na seção "Hoje" o dia é redundante: mostra só o horário. */
  compact?: boolean;
}) {
  const late = task.dueDate !== null && task.dueDate < today;
  const tag = task.fatal ? "Prazo fatal" : TYPE_TAG[task.type];
  return (
    <li className={`mini-item${late ? " late" : ""}`} style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}>
      <button
        type="button"
        className="mini-check"
        aria-label={`Marcar ${task.title} como concluída`}
        onClick={() => onComplete(task)}
      >
        <span>
          <CheckIcon />
        </span>
      </button>
      <Link href={`/mini/tarefa/${task.id}`} className="mini-body" aria-label={`Abrir ${task.title}`}>
        <div>
          <strong>{task.title}</strong>
          <span className="mini-meta">
            {late ? (
              <span className="late-text">
                <ClockIcon />
                {whenLabel(task, today)}
              </span>
            ) : (
              <span className={task.dueTime !== null ? "mini-time" : undefined}>
                {compact ? timeOnlyLabel(task) : whenLabel(task, today)}
              </span>
            )}
            {tag && <span className="mini-tag">{tag}</span>}
          </span>
        </div>
        <ChevronIcon />
      </Link>
    </li>
  );
}
