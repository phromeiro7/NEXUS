"use client";

import { useState, type FormEvent } from "react";
import { createTaskInputSchema } from "@nexus/shared";
import { useToast } from "@/components/mini/toast";
import { useCreateTask, useDeleteTask } from "@/hooks/queries";
import { messageFor } from "@/lib/messages";
import { Dialog } from "./dialog";

/** Mesmo limite de título do schema compartilhado (createTaskInputSchema). */
const TASK_TITLE_MAX_LENGTH = 200;

/** Nova tarefa com título, dia e horário opcionais. Sem dia, a tarefa fica sem data (nada é assumido). */
export function NewTaskDialog({ onClose }: { onClose: () => void }) {
  const createTask = useCreateTask();
  const deleteTask = useDeleteTask();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (createTask.isPending) return;
    if (time !== "" && date === "") {
      setError("Escolha o dia para usar um horário.");
      return;
    }
    const parsed = createTaskInputSchema.safeParse({
      title: title.trim(),
      type: "tarefa",
      dueDate: date === "" ? null : date,
      dueTime: time === "" ? null : time,
    });
    if (!parsed.success) {
      setError(`Escreva o que precisa ser feito (até ${TASK_TITLE_MAX_LENGTH} caracteres) e confira o dia e o horário.`);
      return;
    }
    setError(null);
    try {
      const task = await createTask.mutateAsync(parsed.data);
      onClose();
      toast({ message: `Tarefa anotada: ${task.title}.`, undo: () => void deleteTask.mutateAsync(task.id) });
    } catch (caughtError) {
      setError(messageFor(caughtError));
    }
  }

  return (
    <Dialog title="Nova tarefa" onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate className="mini-stack" aria-label="Nova tarefa">
        <label className="mini-label">
          O que precisa ser feito
          <input data-autofocus className="mini-field" value={title} maxLength={TASK_TITLE_MAX_LENGTH} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <div className="pn-two">
          <label className="mini-label">
            Dia
            <input type="date" className="mini-field" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="mini-label">
            Horário
            <input type="time" className="mini-field" value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
        </div>
        {error !== null && (
          <p role="alert" className="mini-fielderr">
            {error}
          </p>
        )}
        <div className="pn-dialog-actions">
          <button type="submit" className="mini-btn primary" disabled={createTask.isPending}>
            {createTask.isPending ? "Salvando…" : "Anotar tarefa"}
          </button>
          <button type="button" className="mini-btn" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </form>
    </Dialog>
  );
}
