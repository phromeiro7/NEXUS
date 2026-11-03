"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { TaskDto } from "@aj/shared";
import { useAssistant } from "@/hooks/use-assistant";
import { formatShort } from "@/lib/dates";
import { messageFor } from "@/lib/messages";
import { inputClass } from "./field";
import { useHighlight } from "./highlight-context";
import { TYPE_LABEL } from "./task-row";

const MAX = 1000;

type Entry =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; text: string; tasks: TaskDto[] };

/** Botão no cabeçalho + atalho Ctrl/Cmd+K que abrem o diálogo de conversa com o assistente. */
export function CommandBar() {
  const { send, pending } = useAssistant();
  const { highlight } = useHighlight();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const returnRef = useRef<HTMLElement | null>(null);
  const nextId = useRef(0);
  const openRef = useRef(false);
  openRef.current = open;
  const busy = useRef(false);
  const titleId = useId();
  const counterId = useId();

  const openDialog = useCallback((from: HTMLElement | null) => {
    returnRef.current = from;
    setOpen(true);
  }, []);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      if (e.repeat) return;
      const active = document.activeElement;
      const from = active instanceof HTMLElement && active !== document.body ? active : buttonRef.current;
      if (!openRef.current) returnRef.current = from;
      setOpen(true);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      const target = returnRef.current;
      if (target?.isConnected) target.focus();
    };
  }, [open]);

  const tooLong = text.length > MAX;
  const canSend = !pending && !tooLong && text.trim() !== "";

  async function submit() {
    if (!canSend || busy.current) return;
    busy.current = true;
    setError(null);
    const sent = text.trim();
    try {
      const reply = await send(sent);
      setEntries((prev) => [
        ...prev,
        { id: nextId.current++, role: "user", text: sent },
        { id: nextId.current++, role: "assistant", text: reply.reply, tasks: reply.affectedTasks },
      ]);
      highlight(reply.affectedTasks.map((t) => t.id));
      setText("");
    } catch (err) {
      setError(messageFor(err));
    } finally {
      busy.current = false;
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void submit();
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => openDialog(buttonRef.current)}
        className="mt-2 flex min-h-10 w-full items-center justify-between gap-3 rounded border border-[var(--color-borda)] px-3 py-1 text-left text-sm text-[var(--color-texto-suave)]"
      >
        <span>Perguntar ao assistente</span>
        <kbd className="rounded border border-[var(--color-borda)] px-1.5 text-xs">Ctrl K</kbd>
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded border border-[var(--color-borda)] bg-[var(--color-superficie)] p-4 text-[var(--color-texto)] backdrop:bg-black/40"
      >
        {open && (
          <div className="flex flex-col gap-3">
            <h2 id={titleId} className="text-lg font-semibold">
              Assistente
            </h2>
            <div
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto text-sm"
            >
              {entries.map((entry) =>
                entry.role === "user" ? (
                  <p key={entry.id} className="self-end whitespace-pre-line break-words rounded bg-[var(--color-borda)] px-2 py-1">
                    {entry.text}
                  </p>
                ) : (
                  <div key={entry.id} className="flex flex-col gap-1">
                    <p className="whitespace-pre-line break-words">{entry.text}</p>
                    {entry.tasks.length > 0 && (
                      <ul className="flex flex-col gap-1">
                        {entry.tasks.map((t) => (
                          <li key={t.id} className="rounded border border-[var(--color-borda)] p-2">
                            <span className="font-medium break-words">{t.title}</span>{" "}
                            <span className="text-xs">{TYPE_LABEL[t.type]}</span>
                            <div className="flex flex-wrap gap-x-3">
                              <span>{t.dueDate === null ? "Sem data" : formatShort(t.dueDate)}</span>
                              {t.dueTime !== null ? (
                                <span className="font-mono">{t.dueTime}</span>
                              ) : (
                                <span className="italic">Dia inteiro</span>
                              )}
                              <span className="font-semibold">Atualizada agora</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ),
              )}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              className="flex flex-col gap-1"
            >
              <label htmlFor={`${titleId}-msg`} className="sr-only">
                Mensagem
              </label>
              <textarea
                id={`${titleId}-msg`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                rows={3}
                aria-describedby={counterId}
                aria-invalid={tooLong}
                placeholder="Ex.: criar prazo de contestação para sexta, 15 dias úteis"
                className={inputClass}
              />
              <p
                id={counterId}
                className={`text-xs ${tooLong ? "font-semibold text-[var(--color-fatal)]" : "text-[var(--color-texto-suave)]"}`}
              >
                {text.length}/{MAX}
              </p>
              {error !== null && (
                <p role="alert" className="text-sm text-[var(--color-fatal)]">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded border border-[var(--color-borda)] px-3 py-2 text-sm"
                >
                  Fechar
                </button>
                <button
                  type="submit"
                  disabled={!canSend}
                  className="rounded bg-[var(--color-destaque)] px-3 py-2 text-sm font-medium text-[var(--color-superficie)] disabled:opacity-60"
                >
                  Enviar
                </button>
              </div>
            </form>
          </div>
        )}
      </dialog>
    </>
  );
}
