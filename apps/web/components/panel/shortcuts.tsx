"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NewTaskDialog } from "./new-task-dialog";

type ShortcutsContextValue = {
  /** A barra de captura se registra aqui (só existe em Hoje e Finanças); sem ela os atalhos não valem. */
  registerCapture(focus: () => void): () => void;
  helpOpen: boolean;
  toggleHelp(): void;
  closeHelp(): void;
  openNewTask(): void;
};

/** Valor fora do provedor: atalhos desligados (componentes funcionam sem quebrar). */
const NO_SHORTCUTS: ShortcutsContextValue = { registerCapture: () => () => {}, helpOpen: false, toggleHelp: () => {}, closeHelp: () => {}, openNewTask: () => {} };
const ShortcutsContext = createContext<ShortcutsContextValue>(NO_SHORTCUTS);
/** Acesso aos atalhos do painel (registro da barra de captura, lista de ajuda, nova tarefa). */
export const useShortcuts = () => useContext(ShortcutsContext);

const TEXT_ENTRY_TAGS = ["INPUT", "TEXTAREA", "SELECT"];
/** Diálogo aberto (qualquer modal): os atalhos globais ficam suspensos. */
const OPEN_MODAL_SELECTOR = '[aria-modal="true"]';

/** Quem está digitando (ou escolhendo numa lista) não aciona atalhos. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || TEXT_ENTRY_TAGS.includes(target.tagName);
}

/**
 * Atalhos do painel: N nova tarefa, / ir para a barra de captura, ? mostrar a lista, Esc fechar a lista.
 * Só valem em Hoje e Finanças, sem Ctrl/Alt/Cmd, fora de campos de texto e com nenhum diálogo aberto.
 */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const focusCaptureRef = useRef<(() => void) | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  // Devolve a função de cancelamento; só limpa se ainda for o mesmo registro (evita apagar uma barra mais nova).
  const registerCapture = useCallback((focus: () => void) => {
    focusCaptureRef.current = focus;
    return () => {
      if (focusCaptureRef.current === focus) focusCaptureRef.current = null;
    };
  }, []);

  // Atalhos globais no documento. preventDefault evita que a tecla ("/", "n", "?") seja digitada no campo focado em seguida.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
      if (event.defaultPrevented || hasModifier) return;
      if (isTyping(event.target) || document.querySelector(OPEN_MODAL_SELECTOR) !== null) return;
      if (focusCaptureRef.current === null) return;
      if (event.key === "/") {
        event.preventDefault();
        focusCaptureRef.current();
      } else if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        setNewTaskOpen(true);
      } else if (event.key === "?") {
        event.preventDefault();
        setHelpOpen((open) => !open);
      } else if (event.key === "Escape") {
        setHelpOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const value = useMemo<ShortcutsContextValue>(
    () => ({
      registerCapture,
      helpOpen,
      toggleHelp: () => setHelpOpen((open) => !open),
      closeHelp: () => setHelpOpen(false),
      openNewTask: () => setNewTaskOpen(true),
    }),
    [registerCapture, helpOpen],
  );

  return (
    <ShortcutsContext.Provider value={value}>
      {children}
      {newTaskOpen && <NewTaskDialog onClose={() => setNewTaskOpen(false)} />}
    </ShortcutsContext.Provider>
  );
}
