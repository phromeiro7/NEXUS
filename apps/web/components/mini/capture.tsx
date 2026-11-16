"use client";

import { useId, useRef, useState, type FocusEvent, type FormEvent } from "react";
import { createTaskInputSchema, type IsoDate } from "@nexus/shared";
import { useCreateTask, useDeleteTask } from "@/hooks/queries";
import { addDays } from "@/lib/dates";
import { messageFor } from "@/lib/messages";
import { captureSummary } from "@/lib/mini-tasks";
import { PlusIcon } from "./icons";
import { useToast } from "./toast";

type Quick = "hoje" | "amanha" | "outro" | null;

/**
 * Captura em três passos: O quê, Quando e Horário. Digitar e Enter já anota; os passos de
 * data e hora aparecem ao focar. O horário só vale com um dia confirmado, e sem data a
 * tarefa fica "sem data" (o app avisa); nunca agenda no escuro.
 */
export function Capture({ today }: { today: IsoDate }) {
  const create = useCreateTask();
  const del = useDeleteTask();
  const toast = useToast();
  const ids = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [title, setTitle] = useState("");
  const [quick, setQuick] = useState<Quick>(null);
  const [other, setOther] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const date: IsoDate | null =
    quick === "outro" ? (other !== "" ? (other as IsoDate) : null) : quick === "hoje" ? today : quick === "amanha" ? addDays(today, 1) : null;
  const dirty = title !== "" || quick !== null || time !== "";
  const expanded = focused || dirty;
  const summary = captureSummary(date, time, today);

  // Safari não dá foco a botões: espera o toque nos atalhos chegar antes de recolher.
  function onBlur(e: FocusEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    if (form.contains(e.relatedTarget)) return;
    setTimeout(() => {
      if (!form.contains(document.activeElement)) setFocused(false);
    }, 250);
  }

  function pick(next: Exclude<Quick, null>) {
    if (quick === next) {
      setQuick(null);
      setTime("");
      return;
    }
    setQuick(next);
    if (next !== "outro") setOther("");
  }

  function reset() {
    setTitle("");
    setQuick(null);
    setOther("");
    setTime("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
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
    busy.current = true;
    setError(null);
    try {
      const task = await create.mutateAsync(parsed.data);
      toast({
        message: `Anotado: ${trimmed}. ${summary.scheduled ? `${summary.when}.` : "Sem data: defina quando para receber o lembrete."}`,
        undo: () => void del.mutateAsync(task.id).catch(() => toast({ message: "Não foi possível desfazer. Abra a tarefa para excluir." })),
      });
      reset();
      inputRef.current?.focus();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      busy.current = false;
    }
  }

  const dayId = `${ids}-dia`;
  const timeId = `${ids}-hora`;
  const hintId = `${ids}-dica`;

  return (
    <form
      className="mini-capture"
      data-expanded={expanded}
      onSubmit={submit}
      // O "+" some ao expandir: focá-lo não expande, senão o toque se perde antes do clique.
      onFocus={(e) => {
        if (!(e.target instanceof HTMLButtonElement && e.target.classList.contains("mini-add"))) setFocused(true);
      }}
      onBlur={onBlur}
      noValidate
      aria-label="Nova tarefa"
    >
      <div className="mini-step">
        <label htmlFor={`${ids}-titulo`} className="mini-step-label">
          O quê
        </label>
        <div className="mini-capture-line">
          <input
            ref={inputRef}
            id={`${ids}-titulo`}
            data-capture-title
            className="mini-field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex.: buscar encomenda"
            maxLength={200}
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
              <button type="button" className="mini-chip" aria-pressed={quick === "hoje"} onClick={() => pick("hoje")}>
                Hoje
              </button>
              <button type="button" className="mini-chip" aria-pressed={quick === "amanha"} onClick={() => pick("amanha")}>
                Amanhã
              </button>
              <button type="button" className="mini-chip" aria-pressed={quick === "outro"} onClick={() => pick("outro")}>
                Outro dia
              </button>
            </div>
            {quick === "outro" && (
              <label className="mini-label" htmlFor={dayId}>
                <span className="mini-sr">Dia</span>
                <input id={dayId} type="date" className="mini-field" value={other} onChange={(e) => setOther(e.target.value)} />
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
              onChange={(e) => setTime(e.target.value)}
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
