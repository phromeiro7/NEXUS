import type { ReactNode } from "react";
import "../nexus.css";

/** Rotas de acesso (entrar, recuperar, nova senha): só carregam o estilo do Nexus. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
