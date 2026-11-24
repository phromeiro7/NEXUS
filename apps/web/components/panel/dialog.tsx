"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { CloseIcon } from "@/components/mini/icons";

/** Elementos que recebem foco pelo Tab: usados para prender o foco dentro do diálogo. */
const FOCUSABLE_SELECTOR = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Diálogo modal do painel. Foco vai para o primeiro campo (ou o que tiver `data-autofocus`), Tab não sai
 * dele, Esc e o clique fora fecham, e o foco volta para quem abriu.
 */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Ao abrir: guarda quem tinha o foco e foca o primeiro campo; ao fechar, devolve o foco para lá.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialogElement = dialogRef.current;
    // Primeiro campo de formulário; sem campo, o primeiro item focável (o botão Fechar) ou o próprio diálogo.
    const initialFocus =
      dialogElement?.querySelector<HTMLElement>("[data-autofocus]") ??
      dialogElement?.querySelector<HTMLElement>("input:not([disabled]),select:not([disabled]),textarea:not([disabled])") ??
      dialogElement?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      dialogElement;
    initialFocus?.focus();
    return () => opener?.focus?.();
  }, []);

  // Esc fecha (sem propagar para os atalhos globais); Tab e Shift+Tab dão a volta dentro do diálogo.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) return;
    const focusableItems = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
    if (focusableItems.length === 0) {
      event.preventDefault();
      return;
    }
    const firstItem = focusableItems[0]!;
    const lastItem = focusableItems[focusableItems.length - 1]!;
    if (event.shiftKey && document.activeElement === firstItem) {
      event.preventDefault();
      lastItem.focus();
    } else if (!event.shiftKey && document.activeElement === lastItem) {
      event.preventDefault();
      firstItem.focus();
    }
  }

  return (
    <div
      className="pn-backdrop"
      // Clique no fundo (fora do diálogo) fecha.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="pn-dialog" onKeyDown={handleKeyDown}>
        <div className="pn-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="mini-icon-btn" aria-label="Fechar" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
