"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/components/auth-provider";
import { ApiError } from "@/lib/api";

export const inviteKeys = { all: ["invites"] as const };

/** Quem não é administrador recebe 403: a seção de convites simplesmente não existe para essa pessoa. */
export const isForbidden = (error: unknown): boolean => error instanceof ApiError && error.status === 403;

export function useInvites() {
  const api = useApi();
  // Sem nova tentativa: 403 não muda com o tempo e o aviso de erro não deve demorar.
  return useQuery({ queryKey: inviteKeys.all, queryFn: () => api.listInvites(), retry: false, staleTime: 30_000 });
}

export function useCreateInvite() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (label?: string) => api.createInvite(label),
    onSuccess: () => client.invalidateQueries({ queryKey: inviteKeys.all }),
  });
}

export function useDeleteInvite() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.deleteInvite(code),
    onSuccess: () => client.invalidateQueries({ queryKey: inviteKeys.all }),
  });
}
