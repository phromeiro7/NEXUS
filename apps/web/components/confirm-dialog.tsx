"use client";

import { useEffect, useId, useRef } from "react";

/**
 * Diálogo de confirmação sobre o <dialog> nativo (showModal: foco preso e fundo inerte).
 * Escape dispara `cancel`, tratado como Cancelar; ao fechar, o foco volta ao elemento que o abriu.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      return () => {
        if (dialog.open) dialog.close();
        opener?.focus();
      };
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onCancel();
      }}
      className="m-auto max-w-sm rounded border border-[var(--color-borda)] bg-[var(--color-superficie)] p-4 text-[var(--color-texto)] backdrop:bg-black/40"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        {title}
      </h2>
      <p id={messageId} className="mt-2 break-words text-sm">
        {message}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded border border-[var(--color-borda)] px-3 py-2 text-sm disabled:opacity-60"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="rounded bg-[var(--color-fatal)] px-3 py-2 text-sm font-medium text-[var(--color-superficie)] disabled:opacity-60"
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
