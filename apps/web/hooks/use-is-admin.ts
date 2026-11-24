"use client";

import { useInvites } from "./use-invites";

/**
 * Quem administra o Nexus: a API só responde à lista de convites para administradores (403 aos demais),
 * então "a lista carregou" quer dizer administrador. `undefined` enquanto não se sabe; qualquer falha esconde
 * a área de administração (falha fechada).
 */
export function useIsAdmin(): boolean | undefined {
  const invites = useInvites();
  if (invites.isSuccess) return true;
  if (invites.isError) return false;
  return undefined;
}
