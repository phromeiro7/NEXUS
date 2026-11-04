"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Toast = { message: string; undo?: () => void };
const ToastContext = createContext<(t: Toast) => void>(() => {});

export const useToast = () => useContext(ToastContext);

const LIFETIME_MS = 8000;

/** Aviso com "Desfazer". Fica numa região de status para leitores de tela e some sozinho. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((t: Toast) => {
    clearTimeout(timer.current);
    setToast(t);
    timer.current = setTimeout(() => setToast(null), LIFETIME_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="mini-toast-zone">
        <div role="status" aria-live="polite">
          {toast && (
            <div className="mini-toast">
              <p>{toast.message}</p>
              {toast.undo && (
                <button
                  type="button"
                  onClick={() => {
                    toast.undo?.();
                    setToast(null);
                  }}
                >
                  Desfazer
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
