"use client";

import { useState, type FormEvent } from "react";
import { updateTaskInputSchema, type IsoDate, type TaskDto, type UpdateTaskInput } from "@nexus/shared";
import { CheckIcon } from "@/components/mini/icons";
import { useToast } from "@/components/mini/toast";
import { useDeleteTask, useUpdateTask } from "@/hooks/queries";
import { messageFor } from "@/lib/messages";
import { postponeOptions, reminderState, whenLabel } from "@/lib/mini-tasks";
import { Dialog } from "./dialog";

type Mode = "view" | "postpone" | "edit" | "cancel";

/** Uma tarefa aberta no painel: concluir, adiar, editar, cancelar ou excluir. Fecha quando a ação termina. */
export function TaskDialog({ task, today, onClose }: { task: TaskDto; today: IsoDate; onClose: () => void }) {
  const toast = useToast();
  const update = useUpdateTask();
  const del = useDeleteTask();
  const [mode, setMode] = useState<Mode>("view");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(task.title);
  const [date, setDate] = useState<string>(task.dueDate ?? "");
  const [time, setTime] = useState<string>(task.dueTime ?? "");
  const pending = update.isPending || del.isPending;

  async function apply(input: UpdateTaskInput, after?: () => void) {
    setError(null);
    try {
      await update.mutateAsync({ id: task.id, input });
      onClose();
      after?.();
    } catch (err) {
      setError(messageFor(err));
    }
  }

  const complete = () =>
    apply({ status: "concluida" }, () =>
      toast({ message: `Tarefa concluída: ${task.title}.`, undo: () => void update.mutateAsync({ id: task.id, input: { status: "pendente" } }) }),
    );

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (time !== "" && date === "") {
      setError("Escolha o dia para usar um horário.");
      return;
    }
    const parsed = updateTaskInputSchema.safeParse({ title: title.trim(), dueDate: date === "" ? null : date, dueTime: time === "" ? null : time });
    if (!parsed.success) {
      setError("Confira o título (até 200 caracteres), o dia e o horário.");
      return;
    }
    await apply(parsed.data);
  }

  async function remove() {
    setError(null);
    try {
      await del.mutateAsync(task.id);
      onClose();
    } catch (err) {
      setError(messageFor(err));
    }
  }

  return (
    <Dialog title={task.title} onClose={onClose}>
      <dl className="pn-facts" style={{ margin: 0 }}>
        <div>
          <dt>Quando</dt>
          <dd style={{ fontSize: "1rem" }}>{whenLabel(task, today)}</dd>
        </div>
        <div>
          <dt>Lembrete</dt>
          <dd style={{ fontSize: "1rem" }}>{reminderState(task)}</dd>
        </div>
      </dl>

      {error !== null && (
        <p role="alert" className="mini-fielderr">
          {error}
        </p>
      )}

      {mode === "view" && (
        <div className="pn-dialog-actions">
          <button type="button" className="mini-btn primary" disabled={pending} onClick={() => void complete()}>
            <CheckIcon /> Concluir
          </button>
          <button type="button" className="mini-btn" onClick={() => setMode("postpone")}>
            Adiar
          </button>
          <button type="button" className="mini-btn" onClick={() => setMode("edit")}>
            Editar
          </button>
          <button type="button" className="mini-btn quiet" onClick={() => setMode("cancel")}>
            Cancelar tarefa
          </button>
        </div>
      )}

      {mode === "postpone" && (
        <section aria-label="Adiar para" className="mini-stack">
          <strong>Adiar para quando?</strong>
          <div className="pn-dialog-actions">
            {postponeOptions(task, today).map((o) => (
              <button key={o.key} type="button" className="mini-btn" disabled={pending} onClick={() => void apply(o.input)}>
                {o.label}
              </button>
            ))}
            <button type="button" className="mini-btn quiet" onClick={() => setMode("view")}>
              Voltar
            </button>
          </div>
        </section>
      )}

      {mode === "edit" && (
        <form onSubmit={saveEdit} noValidate className="mini-stack" aria-label="Editar tarefa">
          <label className="mini-label">
            Título
            <input className="mini-field" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="pn-two">
            <label className="mini-label">
              Dia
              <input type="date" className="mini-field" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="mini-label">
              Horário
              <input type="time" className="mini-field" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
          <div className="pn-dialog-actions">
            <button type="submit" className="mini-btn primary" disabled={pending}>
              Salvar
            </button>
            <button type="button" className="mini-btn quiet" onClick={() => setMode("view")}>
              Voltar
            </button>
          </div>
        </form>
      )}

      {mode === "cancel" && (
        <section role="group" aria-label="Confirmar cancelamento" className="mini-stack">
          <p style={{ margin: 0, fontWeight: 600 }}>Cancelar esta tarefa? Ela sai da lista e você pode reabri-la depois.</p>
          <div className="pn-dialog-actions">
            <button type="button" className="mini-btn danger" disabled={pending} onClick={() => void apply({ status: "cancelada" })}>
              Cancelar tarefa
            </button>
            <button type="button" className="mini-btn" onClick={() => setMode("view")}>
              Manter tarefa
            </button>
            <button type="button" className="mini-btn quiet" disabled={pending} onClick={() => void remove()}>
              Excluir de vez
            </button>
          </div>
        </section>
      )}
    </Dialog>
  );
}
