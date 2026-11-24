"use client";

import Link from "next/link";
import type { IsoDate, TaskDto } from "@nexus/shared";
import { timeOnlyLabel, whenLabel } from "@/lib/mini-tasks";
import { postponeShortcuts, type PostponeKind } from "@/lib/postpone";
import { CheckIcon, ChevronIcon, ClockIcon } from "./icons";

/** Etiqueta exibida ao lado da data para os tipos de tarefa que merecem destaque. */
const TYPE_TAG: Record<string, string> = { prazo: "Prazo", audiencia: "Audiência" };

/** Animação de entrada escalonada: cada linha atrasa um pouco mais, até um teto para listas longas. */
const STAGGER_STEP_MS = 30;
const MAX_STAGGERED_ITEMS = 8;

/** Linha de tarefa das listas do Mini App: concluir, abrir o detalhe e (opcional) adiar para amanhã. */
export function TaskItem({
  task,
  today,
  onComplete,
  onPostpone,
  index = 0,
  compact = false,
}: {
  task: TaskDto;
  today: IsoDate;
  onComplete: (task: TaskDto) => void;
  /** Atalho "Amanhã" na linha; sem isto a linha não mostra adiar. */
  onPostpone?: (task: TaskDto, kind: PostponeKind) => void;
  index?: number;
  /** Na seção "Hoje" o dia é redundante: mostra só o horário. */
  compact?: boolean;
}) {
  const isLate = task.dueDate !== null && task.dueDate < today;
  // O primeiro atalho de adiar é sempre "Amanhã"; os demais ficam no detalhe da tarefa.
  const tomorrowShortcut = onPostpone ? postponeShortcuts(task, today)[0] : undefined;
  const tag = task.fatal ? "Prazo fatal" : TYPE_TAG[task.type];
  return (
    <li className={`mini-item${isLate ? " late" : ""}`}
      style={{ animationDelay: `${Math.min(index, MAX_STAGGERED_ITEMS) * STAGGER_STEP_MS}ms` }}>
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
            {isLate ? (
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
      {tomorrowShortcut && (
        <button
          type="button"
          className="mini-postpone"
          aria-label={tomorrowShortcut.ariaLabel}
          onClick={() => onPostpone?.(task, tomorrowShortcut.kind)}
        >
          {tomorrowShortcut.label}
        </button>
      )}
    </li>
  );
}
