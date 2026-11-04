"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NewTaskDialog } from "./new-task-dialog";

type Shortcuts = {
  /** A barra de captura se registra aqui (só existe em Hoje e Finanças); sem ela os atalhos não valem. */
  registerCapture(focus: () => void): () => void;
  helpOpen: boolean;
  toggleHelp(): void;
  closeHelp(): void;
  openNewTask(): void;
};

const NONE: Shortcuts = { registerCapture: () => () => {}, helpOpen: false, toggleHelp: () => {}, closeHelp: () => {}, openNewTask: () => {} };
const Ctx = createContext<Shortcuts>(NONE);
export const useShortcuts = () => useContext(Ctx);

/** Quem está digitando (ou escolhendo numa lista) não aciona atalhos. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Atalhos do painel: N nova tarefa, / ir para a barra de captura, ? mostrar a lista, Esc fechar a lista.
 * Só valem em Hoje e Finanças, sem Ctrl/Alt/Cmd, fora de campos de texto e com nenhum diálogo aberto.
 */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const focusCapture = useRef<(() => void) | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [newTask, setNewTask] = useState(false);

  const registerCapture = useCallback((focus: () => void) => {
    focusCapture.current = focus;
    return () => {
      if (focusCapture.current === focus) focusCapture.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target) || document.querySelector('[aria-modal="true"]') !== null) return;
      if (focusCapture.current === null) return;
      if (e.key === "/") {
        e.preventDefault();
        focusCapture.current();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setNewTask(true);
      } else if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((v) => !v);
      } else if (e.key === "Escape") {
        setHelpOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo<Shortcuts>(
    () => ({
      registerCapture,
      helpOpen,
      toggleHelp: () => setHelpOpen((v) => !v),
      closeHelp: () => setHelpOpen(false),
      openNewTask: () => setNewTask(true),
    }),
    [registerCapture, helpOpen],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {newTask && <NewTaskDialog onClose={() => setNewTask(false)} />}
    </Ctx.Provider>
  );
}
