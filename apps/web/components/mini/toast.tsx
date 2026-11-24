"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Toast = { message: string; undo?: () => void };
const ToastContext = createContext<(toast: Toast) => void>(() => {});

/** Devolve a função que mostra um aviso (com "Desfazer" opcional). Fora do provider não faz nada. */
export const useToast = () => useContext(ToastContext);

/** Tempo que o aviso fica na tela antes de sumir sozinho. */
const LIFETIME_MS = 8000;

/** Aviso com "Desfazer". Fica numa região de status para leitores de tela e some sozinho. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Um aviso novo substitui o anterior e reinicia a contagem para sumir.
  const showToast = useCallback((nextToast: Toast) => {
    clearTimeout(hideTimer.current);
    setToast(nextToast);
    hideTimer.current = setTimeout(() => setToast(null), LIFETIME_MS);
  }, []);
  // Cancela o timer pendente ao desmontar, para não atualizar estado de componente que já saiu.
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {/* A região de status fica sempre montada: leitores de tela só anunciam mudanças em regiões já existentes. */}
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
