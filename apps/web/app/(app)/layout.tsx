"use client";

import type { ReactNode } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { PanelShell } from "@/components/panel/panel-shell";
import "../nexus.css";
import "../nexus-panel.css";

/** Rotas do painel: exigem sessão (AuthGuard) e ficam dentro da moldura com navegação. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <PanelShell>{children}</PanelShell>
    </AuthGuard>
  );
}
