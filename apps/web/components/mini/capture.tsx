"use client";

import { useId, useRef, useState, type FocusEvent, type FormEvent } from "react";
import { createTaskInputSchema, type IsoDate } from "@nexus/shared";
import { useCreateTask, useDeleteTask } from "@/hooks/queries";
import { addDays } from "@/lib/dates";
import { messageFor } from "@/lib/messages";
import { captureSummary } from "@/lib/mini-tasks";
import { PlusIcon } from "./icons";
import { useToast } from "./toast";

/** Atalho de dia escolhido na captura; `null` = sem data. */
type QuickDay = "hoje" | "amanha" | "outro" | null;

/** Mesmo limite do schema de criação de tarefa (o erro de validação cita "até 200 caracteres"). */
const TITLE_MAX_LENGTH = 200;
/** Espera antes de recolher no blur, para o toque num atalho (sem foco no Safari) chegar primeiro. */
const COLLAPSE_DELAY_MS = 250;

/** Dia escolhido na captura: hoje, amanhã, a data digitada em "Outro dia" ou nenhum. */
function resolveDate(quickDay: QuickDay, otherDate: string, today: IsoDate): IsoDate | null {
  switch (quickDay) {
    case "hoje":
      return today;
    case "amanha":
      return addDays(today, 1);
    case "outro":
      return otherDate !== "" ? (otherDate as IsoDate) : null;
    default:
      return null;
  }
}

/**
 * Captura em três passos: O quê, Quando e Horário. Digitar e Enter já anota; os passos de
 * data e hora aparecem ao focar. O horário só vale com um dia confirmado, e sem data a
 * tarefa fica "sem data" (o app avisa); nunca agenda no escuro.
 */
export function Capture({ today }: { today: IsoDate }) {
  const create = useCreateTask();
  const deleteTask = useDeleteTask();
  const toast = useToast();
  const idPrefix = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // Trava síncrona contra duplo envio (Enter repetido antes do próximo render).
  const submitting = useRef(false);
  const [title, setTitle] = useState("");
  const [quickDay, setQuickDay] = useState<QuickDay>(null);
  const [otherDate, setOtherDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const date = resolveDate(quickDay, otherDate, today);
  const dirty = title !== "" || quickDay !== null || time !== "";
  const expanded = focused || dirty;
  const summary = captureSummary(date, time, today);

  // Safari não dá foco a botões: espera o toque nos atalhos chegar antes de recolher.
  function handleBlur(event: FocusEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    if (form.contains(event.relatedTarget)) return;
    setTimeout(() => {
      if (!form.contains(document.activeElement)) setFocused(false);
    }, COLLAPSE_DELAY_MS);
  }

  /** Tocar no atalho já escolhido desmarca o dia (e limpa o horário, que depende dele). */
  function pickDay(nextDay: Exclude<QuickDay, null>) {
    if (quickDay === nextDay) {
      setQuickDay(null);
      setTime("");
      return;
    }
    setQuickDay(nextDay);
    if (nextDay !== "outro") setOtherDate("");
  }

  function reset() {
    setTitle("");
    setQuickDay(null);
    setOtherDate("");
    setTime("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const trimmed = title.trim();
    if (trimmed === "") {
      setError("Escreva o que você precisa lembrar.");
      inputRef.current?.focus();
      return;
    }
    if (time !== "" && date === null) {
      setError("Escolha o dia para usar um horário.");
      return;
    }
    const parsed = createTaskInputSchema.safeParse({
      title: trimmed,
      type: "tarefa",
      ...(date !== null ? { dueDate: date } : {}),
      ...(time !== "" ? { dueTime: time } : {}),
    });
    if (!parsed.success) {
      setError("Confira o texto (até 200 caracteres), o dia e o horário.");
      return;
    }
    submitting.current = true;
    setError(null);
    try {
      const task = await create.mutateAsync(parsed.data);
      // "Desfazer" exclui a tarefa recém-criada.
      toast({
        message: `Anotado: ${trimmed}. ${summary.scheduled ? `${summary.when}.` : "Sem data: defina quando para receber o lembrete."}`,
        undo: () => void deleteTask.mutateAsync(task.id).catch(() => toast({ message: "Não foi possível desfazer. Abra a tarefa para excluir." })),
      });
      reset();
      inputRef.current?.focus();
    } catch (createError) {
      setError(messageFor(createError));
    } finally {
      submitting.current = false;
    }
  }

  const titleId = `${idPrefix}-titulo`;
  const dayId = `${idPrefix}-dia`;
  const timeId = `${idPrefix}-hora`;
  const hintId = `${idPrefix}-dica`;

  return (
    <form
      className="mini-capture"
      data-expanded={expanded}
      onSubmit={submit}
      // O "+" some ao expandir: focá-lo não expande, senão o toque se perde antes do clique.
      onFocus={(event) => {
        if (!(event.target instanceof HTMLButtonElement && event.target.classList.contains("mini-add"))) setFocused(true);
      }}
      onBlur={handleBlur}
      noValidate
      aria-label="Nova tarefa"
    >
      <div className="mini-step">
        <label htmlFor={titleId} className="mini-step-label">
          O quê
        </label>
        <div className="mini-capture-line">
          <input
            ref={inputRef}
            id={titleId}
            data-capture-title
            className="mini-field"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ex.: buscar encomenda"
            maxLength={TITLE_MAX_LENGTH}
            enterKeyHint="done"
            autoComplete="off"
          />
          {!expanded && (
            <button type="submit" className="mini-add" disabled={create.isPending} aria-label="Adicionar tarefa">
              <PlusIcon />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mini-capture-more">
          <fieldset className="mini-step">
            <legend>Quando</legend>
            <div className="mini-chips">
              <button type="button" className="mini-chip" aria-pressed={quickDay === "hoje"} onClick={() => pickDay("hoje")}>
                Hoje
              </button>
              <button type="button" className="mini-chip" aria-pressed={quickDay === "amanha"} onClick={() => pickDay("amanha")}>
                Amanhã
              </button>
              <button type="button" className="mini-chip" aria-pressed={quickDay === "outro"} onClick={() => pickDay("outro")}>
                Outro dia
              </button>
            </div>
            {quickDay === "outro" && (
              <label className="mini-label" htmlFor={dayId}>
                <span className="mini-sr">Dia</span>
                <input id={dayId} type="date" className="mini-field" value={otherDate} onChange={(event) => setOtherDate(event.target.value)} />
              </label>
            )}
          </fieldset>

          <div className="mini-step">
            <label htmlFor={timeId} className="mini-step-label">
              Horário <span className="mini-hint">(opcional)</span>
            </label>
            <input
              id={timeId}
              type="time"
              className="mini-field"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              disabled={date === null}
              aria-describedby={hintId}
            />
            <p id={hintId} className="mini-hint">
              {date === null ? "Escolha um dia para definir o horário." : "Sem horário, a tarefa vale o dia todo."}
            </p>
          </div>

          <p className="mini-summary">
            Será anotada: <b>{summary.when}</b>
            {!summary.scheduled && " (fica na lista, sem lembrete)"}
          </p>

          <button type="submit" className="mini-btn primary" disabled={create.isPending}>
            <PlusIcon />
            Adicionar tarefa
          </button>
        </div>
      )}

      {error !== null && (
        <p role="alert" className="mini-fielderr">
          {error}
        </p>
      )}
    </form>
  );
}
