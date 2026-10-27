"use client";

import { useRef, useState } from "react";
import type { TaskDto } from "@aj/shared";
import { useDeleteTask } from "@/hooks/queries";
import { messageFor } from "@/lib/messages";
import { ConfirmDialog } from "./confirm-dialog";
import { TaskForm } from "./task-form";

const btn = "min-h-10 rounded border border-[var(--color-borda)] px-2 py-1 text-sm";

/** "Editar" (formulário na própria linha) e "Excluir" (com confirmação) de uma tarefa. */
export function TaskRowActions({ task }: { task: TaskDto }) {
  const del = useDeleteTask();
  const editRef = useRef<HTMLButtonElement>(null);
  const returnRef = useRef<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setError(null);
    try {
      await del.mutateAsync(task.id);
      // A linha some: o foco vai para um alvo estável (título do Painel), não para o corpo da página.
      returnRef.current = document.querySelector<HTMLElement>("[data-after-delete-focus]");
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          ref={editRef}
          type="button"
          className={btn}
          aria-label={`Editar ${task.title}`}
          onClick={() => setEditing(true)}
        >
          Editar
        </button>
        <button
          type="button"
          className={btn}
          aria-label={`Excluir ${task.title}`}
          onClick={(e) => {
            returnRef.current = e.currentTarget;
            setError(null);
            setConfirming(true);
          }}
        >
          Excluir
        </button>
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-[var(--color-fatal)]">
          {error}
        </p>
      )}
      {editing && (
        <TaskForm
          task={task}
          onDone={() => {
            setEditing(false);
            editRef.current?.focus();
          }}
        />
      )}
      <ConfirmDialog
        open={confirming}
        title="Excluir tarefa?"
        message={`“${task.title}” será excluída. Esta ação não pode ser desfeita.`}
        confirmLabel="Sim, excluir"
        pending={del.isPending}
        returnFocusRef={returnRef}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
