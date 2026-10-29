"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** Tempo em que uma tarefa alterada pelo assistente fica marcada "Atualizada agora". */
export const HIGHLIGHT_MS = 8_000;

type HighlightValue = {
  highlight(ids: readonly string[]): void;
  isHighlighted(id: string): boolean;
};

const NONE: HighlightValue = { highlight: () => undefined, isHighlighted: () => false };
const HighlightContext = createContext<HighlightValue>(NONE);

/** Guarda os ids afetados pelo assistente; cada um expira sozinho depois de HIGHLIGHT_MS. */
export function HighlightProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const highlight = useCallback((incoming: readonly string[]) => {
    if (incoming.length === 0) return;
    setIds((prev) => new Set([...prev, ...incoming]));
    for (const id of incoming) {
      const old = timers.current.get(id);
      if (old !== undefined) clearTimeout(old);
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, HIGHLIGHT_MS),
      );
    }
  }, []);

  const value = useMemo<HighlightValue>(
    () => ({ highlight, isHighlighted: (id) => ids.has(id) }),
    [highlight, ids],
  );
  return <HighlightContext.Provider value={value}>{children}</HighlightContext.Provider>;
}

export function useHighlight(): HighlightValue {
  return useContext(HighlightContext);
}
