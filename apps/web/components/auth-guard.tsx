"use client";

import { useEffect, type ReactNode } from "react";
import { useAuth } from "./auth-provider";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { status, redirectToLogin, configError } = useAuth();

  useEffect(() => {
    if (status === "signedOut" && configError === null) redirectToLogin();
  }, [status, configError, redirectToLogin]);

  if (configError !== null) {
    return (
      <main className="mx-auto max-w-md p-4">
        <p role="alert" className="text-[var(--color-fatal)]">
          Configuração incompleta do painel. {configError}
        </p>
      </main>
    );
  }
  if (status !== "signedIn") {
    return (
      <main className="mx-auto max-w-md p-4">
        <p role="status">Carregando…</p>
      </main>
    );
  }
  return <>{children}</>;
}
