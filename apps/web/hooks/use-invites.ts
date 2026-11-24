"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/components/auth-provider";
import { ApiError } from "@/lib/api";
import { HTTP_FORBIDDEN } from "@/lib/http";

/** Chave de cache da lista de convites. */
export const inviteKeys = { all: ["invites"] as const };

/** A lista muda pouco: evita recarregar a cada troca de tela. */
const INVITES_STALE_TIME_MS = 30_000;

/** Quem não é administrador recebe 403: a seção de convites simplesmente não existe para essa pessoa. */
export const isForbidden = (error: unknown): boolean => error instanceof ApiError && error.status === HTTP_FORBIDDEN;

/** Convites existentes; só administradores conseguem lê-los (ver `isForbidden`). */
export function useInvites() {
  const api = useApi();
  // Sem nova tentativa: 403 não muda com o tempo e o aviso de erro não deve demorar.
  return useQuery({ queryKey: inviteKeys.all, queryFn: () => api.listInvites(), retry: false, staleTime: INVITES_STALE_TIME_MS });
}

/** Cria um convite (com rótulo opcional) e recarrega a lista. */
export function useCreateInvite() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (label?: string) => api.createInvite(label),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inviteKeys.all }),
  });
}

/** Apaga um convite pelo código e recarrega a lista. */
export function useDeleteInvite() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.deleteInvite(code),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: inviteKeys.all }),
  });
}
