"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { updateTaskInputSchema, type IsoDate } from "@nexus/shared";
import { useDeleteTask, useTask, useUpdateTask } from "@/hooks/queries";
import { usePostpone } from "@/hooks/use-postpone";
import { useToday } from "@/hooks/use-today";
import { ApiError } from "@/lib/api";
import { messageFor } from "@/lib/messages";
import { reminderState, whenLabel } from "@/lib/mini-tasks";
import { postponeOptions, type PostponeOption } from "@/lib/postpone";
import { BackIcon, CheckIcon } from "./icons";
import { useToast } from "./toast";

const TYPE_LABEL = { prazo: "Prazo", tarefa: "Tarefa", audiencia: "Audiência" } as const;
/** Mesmo limite de título do schema de tarefa (citado na mensagem de validação). */
const TITLE_MAX_LENGTH = 200;

type TaskDetailMode = "view" | "postpone" | "edit" | "cancel";

/** Tela de detalhe de uma tarefa no Mini App (/mini/tarefa/[id]): concluir, adiar, editar e cancelar. */
export function TaskDetail({ id }: { id: string }) {
  const today = useToday();
  const taskQuery = useTask(id);
  const backLink = (
    <Link href="/mini" className="mini-back">
      <BackIcon /> Hoje
    </Link>
  );

  if (taskQuery.isError) {
    const notFound = taskQuery.error instanceof ApiError && taskQuery.error.status === 404;
    return (
      <main>
        {backLink}
        <p role="alert" className="mini-alert">
          {notFound ? "Não encontramos esta tarefa. Ela pode ter sido excluída." : "Não foi possível abrir a tarefa. Tente de novo."}
        </p>
      </main>
    );
  }
  if (taskQuery.isPending || today === null) {
    return (
      <main role="status" aria-label="Carregando tarefa">
        {backLink}
        <div className="mini-skeleton" style={{ marginTop: 16, height: 160 }} />
      </main>
    );
  }
  const task = taskQuery.data;
  // A key recria o detalhe quando a tarefa muda no servidor, reiniciando o formulário de edição.
  return <LoadedTaskDetail key={task.updatedAt} task={task} today={today} back={backLink} />;
}

function LoadedTaskDetail({
  task,
  today,
  back,
}: {
  task: NonNullable<ReturnType<typeof useTask>["data"]>;
  today: IsoDate;
  back: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const update = useUpdateTask();
  const deleteTask = useDeleteTask();
  const postponer = usePostpone();
  // A tela mostra um painel de cada vez: ações, opções de adiar, edição ou confirmação de cancelamento.
  const [mode, setMode] = useState<TaskDetailMode>("view");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(task.title);
  const [date, setDate] = useState<string>(task.dueDate ?? "");
  const [time, setTime] = useState<string>(task.dueTime ?? "");

  const isOpen = task.status === "pendente" || task.status === "em_andamento";

  /** Salva a alteração, volta para as ações e, se deu certo, roda `onSuccess`. */
  async function applyUpdate(input: Parameters<typeof update.mutateAsync>[0]["input"], onSuccess?: () => void) {
    setError(null);
    try {
      await update.mutateAsync({ id: task.id, input });
      setMode("view");
      onSuccess?.();
    } catch (updateError) {
      setError(messageFor(updateError));
    }
  }

  async function postponeTo(input: PostponeOption["input"]) {
    setError(null);
    if (await postponer.postpone(task, input, today)) setMode("view");
  }

  async function complete() {
    const previousStatus = task.status;
    await applyUpdate({ status: "concluida" }, () =>
      toast({
        message: `Tarefa concluída: ${task.title}.`,
        // Desfazer devolve o status anterior; se já estava concluída, reabre como pendente.
        undo: () =>
          void update.mutateAsync({
            id: task.id,
            input: { status: previousStatus === "concluida" ? "pendente" : previousStatus },
          }),
      }),
    );
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (time !== "" && date === "") {
      setError("Escolha o dia para usar um horário.");
      return;
    }
    const parsed = updateTaskInputSchema.safeParse({
      title: title.trim(),
      dueDate: date === "" ? null : date,
      dueTime: time === "" ? null : time,
    });
    if (!parsed.success) {
      setError("Confira o título (até 200 caracteres), o dia e o horário.");
      return;
    }
    await applyUpdate(parsed.data);
  }

  async function cancelTask() {
    await applyUpdate({ status: "cancelada" }, () => router.push("/mini"));
  }

  async function remove() {
    setError(null);
    try {
      await deleteTask.mutateAsync(task.id);
      router.push("/mini");
    } catch (deleteError) {
      setError(messageFor(deleteError));
    }
  }

  const pending = update.isPending || deleteTask.isPending || postponer.pending;
  const shownError = error ?? postponer.error;
  const tag = task.fatal ? "Prazo fatal" : TYPE_LABEL[task.type];

  return (
    <main>
      {back}
      <header className="mini-hero">
        <h1 style={{ overflowWrap: "anywhere", fontSize: "1.75rem", lineHeight: 1.15 }}>{task.title}</h1>
        <p className="mini-hero-date">{tag}</p>
      </header>

      <div className="mini-card">
        <dl className="mini-facts">
          <div>
            <dt>Quando</dt>
            <dd>{whenLabel(task, today)}</dd>
          </div>
          <div>
            <dt>Lembrete</dt>
            <dd>{reminderState(task)}</dd>
          </div>
        </dl>
      </div>

      {shownError !== null && (
        <p role="alert" className="mini-alert">
          {shownError}
        </p>
      )}

      {mode === "view" && (
        <div className="mini-actions">
          {isOpen ? (
            <>
              <button type="button" className="mini-btn primary" disabled={pending} onClick={() => void complete()}>
                <CheckIcon /> Concluir tarefa
              </button>
              <button type="button" className="mini-btn" onClick={() => setMode("postpone")}>
                Adiar
              </button>
              <button type="button" className="mini-btn" onClick={() => setMode("edit")}>
                Editar ou reagendar
              </button>
              <button type="button" className="mini-btn quiet" onClick={() => setMode("cancel")}>
                Cancelar tarefa
              </button>
            </>
          ) : (
            <button type="button" className="mini-btn primary" disabled={pending} onClick={() => void applyUpdate({ status: "pendente" })}>
              Reabrir tarefa
            </button>
          )}
        </div>
      )}

      {mode === "postpone" && (
        <section className="mini-card" aria-label="Adiar para">
          <h2 style={{ margin: 0, fontSize: "1.0625rem" }}>Adiar para quando?</h2>
          <div className="mini-sheet">
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
        <form className="mini-card mini-sheet" onSubmit={saveEdit} noValidate aria-label="Editar tarefa">
          <label className="mini-label">
            Título
            <input className="mini-field" value={title} maxLength={TITLE_MAX_LENGTH} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <div className="mini-stack">
            <label className="mini-label">
              Dia
              <input type="date" className="mini-field" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label className="mini-label">
              Horário
              <input type="time" className="mini-field" value={time} onChange={(event) => setTime(event.target.value)} />
            </label>
          </div>
          <button type="submit" className="mini-btn primary" disabled={pending} style={{ justifyContent: "center" }}>
            Salvar
          </button>
          <button type="button" className="mini-btn quiet" onClick={() => setMode("view")} style={{ justifyContent: "center" }}>
            Voltar
          </button>
        </form>
      )}

      {mode === "cancel" && (
        <section className="mini-card" role="group" aria-label="Confirmar cancelamento">
          <p style={{ margin: 0, fontWeight: 600 }}>Cancelar esta tarefa? Ela sai da lista de hoje e você pode reabri-la depois.</p>
          <div className="mini-actions">
            <button type="button" className="mini-btn danger" disabled={pending} onClick={() => void cancelTask()}>
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
    </main>
  );
}
