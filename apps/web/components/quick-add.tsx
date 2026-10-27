"use client";

import { useRef, useState, type FormEvent } from "react";
import { createTaskInputSchema } from "@aj/shared";
import { useCreateTask } from "@/hooks/queries";
import { messageFor } from "@/lib/messages";
import { inputClass } from "./auth-form";

/** Adição rápida: título + data opcional, cria uma `tarefa` e devolve o foco ao campo. */
export function QuickAdd() {
  const create = useCreateTask();
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    const trimmed = title.trim();
    if (trimmed === "") return;
    const parsed = createTaskInputSchema.safeParse({
      title: trimmed,
      type: "tarefa",
      ...(date !== "" ? { dueDate: date } : {}),
    });
    if (!parsed.success) {
      setError("Confira o título (até 200 caracteres) e a data.");
      return;
    }
    busy.current = true;
    setError(null);
    try {
      await create.mutateAsync(parsed.data);
      setTitle("");
      setDate("");
      inputRef.current?.focus();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      busy.current = false;
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mb-4 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="quick-add-title" className="sr-only">
          Nova tarefa
        </label>
        <input
          ref={inputRef}
          id="quick-add-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Nova tarefa…"
          maxLength={200}
          className={`${inputClass} min-w-0 flex-1 basis-48`}
        />
        <label htmlFor="quick-add-date" className="sr-only">
          Data
        </label>
        <input
          id="quick-add-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={`${inputClass} w-auto`}
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded bg-[var(--color-destaque)] px-3 py-2 font-medium text-[var(--color-superficie)] disabled:opacity-60"
        >
          Adicionar
        </button>
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-[var(--color-fatal)]">
          {error}
        </p>
      )}
    </form>
  );
}
