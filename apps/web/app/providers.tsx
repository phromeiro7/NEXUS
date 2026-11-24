"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AuthProvider } from "@/components/auth-provider";

/** Cache de consultas novas antes de considerar velhas e buscar de novo. */
const QUERY_STALE_TIME_MS = 30_000;

/** Provedores globais: cache de consultas (React Query) e sessão; o cache é entregue ao AuthProvider para ser esvaziado ao trocar de usuário. */
export function Providers({ children }: { children: ReactNode }) {
  // useState garante um único QueryClient por montagem (não recriado a cada renderização).
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true, staleTime: QUERY_STALE_TIME_MS } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider queryClient={queryClient}>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
