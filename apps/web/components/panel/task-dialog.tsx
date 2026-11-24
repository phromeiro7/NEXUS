"use client";

import { useState, type FormEvent } from "react";
import { TASK_TITLE_MAX, updateTaskInputSchema, type IsoDate, type TaskDto, type UpdateTaskInput } from "@nexus/shared";
import { CheckIcon } from "@/components/mini/icons";
import { useToast } from "@/components/mini/toast";
import { useDeleteTask, useUpdateTask } from "@/hooks/queries";
import { usePostpone } from "@/hooks/use-postpone";
import { messageFor } from "@/lib/messages";
import { reminderState, whenLabel } from "@/lib/mini-tasks";
import { postponeOptions, type PostponeOption } from "@/lib/postpone";
import { Dialog } from "./dialog";

/** Qual painel do diálogo está aberto: ações, opções de adiar, edição ou confirmação de cancelamento. */
type DialogMode = "view" | "postpone" | "edit" | "cancel";

/** Uma tarefa aberta no painel: concluir, adiar, editar, cancelar ou excluir. Fecha quando a ação termina. */
export function TaskDialog({ task, today, onClose }: { task: TaskDto; today: IsoDate; onClose: () => void }) {
  const toast = useToast();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const postponer = usePostpone();
  const [mode, setMode] = useState<DialogMode>("view");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(task.title);
  const [date, setDate] = useState<string>(task.dueDate ?? "");
  const [time, setTime] = useState<string>(task.dueTime ?? "");
  const pending = updateTask.isPending || deleteTask.isPending || postponer.pending;
  const shownError = error ?? postponer.error;

  /** Grava a alteração e fecha; `afterClose` roda só em caso de sucesso (ex.: o aviso com desfazer). */
  async function applyUpdate(input: UpdateTaskInput, afterClose?: () => void) {
    setError(null);
    try {
      await updateTask.mutateAsync({ id: task.id, input });
      onClose();
      afterClose?.();
    } catch (caughtError) {
      setError(messageFor(caughtError));
    }
  }

  const completeTask = () =>
    applyUpdate({ status: "concluida" }, () =>
      toast({ message: `Tarefa concluída: ${task.title}.`, undo: () => void updateTask.mutateAsync({ id: task.id, input: { status: "pendente" } }) }),
    );

  async function postponeTo(input: PostponeOption["input"]) {
    setError(null);
    if (await postponer.postpone(task, input, today)) onClose();
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (time !== "" && date === "") {
      setError("Escolha o dia para usar um horário.");
      return;
    }
    const parsed = updateTaskInputSchema.safeParse({ title: title.trim(), dueDate: date === "" ? null : date, dueTime: time === "" ? null : time });
    if (!parsed.success) {
      setError(`Confira o título (até ${TASK_TITLE_MAX} caracteres), o dia e o horário.`);
      return;
    }
    await applyUpdate(parsed.data);
  }

  async function deleteForever() {
    setError(null);
    try {
      await deleteTask.mutateAsync(task.id);
      onClose();
    } catch (caughtError) {
      setError(messageFor(caughtError));
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

      {shownError !== null && (
        <p role="alert" className="mini-fielderr">
          {shownError}
        </p>
      )}

      {mode === "view" && (
        <div className="pn-dialog-actions">
          <button type="button" className="mini-btn primary" disabled={pending} onClick={() => void completeTask()}>
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
            {postponeOptions(task, today).map((option) => (
              <button key={option.key} type="button" className="mini-btn" disabled={pending} onClick={() => void postponeTo(option.input)}>
                {option.label}
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
            <input className="mini-field" value={title} maxLength={TASK_TITLE_MAX} onChange={(event) => setTitle(event.target.value)} />
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
            <button type="button" className="mini-btn danger" disabled={pending} onClick={() => void applyUpdate({ status: "cancelada" })}>
              Cancelar tarefa
            </button>
            <button type="button" className="mini-btn" onClick={() => setMode("view")}>
              Manter tarefa
            </button>
            <button type="button" className="mini-btn quiet" disabled={pending} onClick={() => void deleteForever()}>
              Excluir de vez
            </button>
          </div>
        </section>
      )}
    </Dialog>
  );
}
