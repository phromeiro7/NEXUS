"use client";

import { useInvites } from "./use-invites";

/**
 * Quem administra o Nexus: a API só responde à lista de convites para administradores (403 aos demais),
 * então "a lista carregou" quer dizer administrador. `undefined` enquanto não se sabe; qualquer falha esconde
 * a área de administração (falha fechada).
 */
export function useIsAdmin(): boolean | undefined {
  const q = useInvites();
  if (q.isSuccess) return true;
  if (q.isError) return false;
  return undefined;
}
