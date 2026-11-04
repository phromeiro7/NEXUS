"use client";

import type { ReactNode } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { PanelShell } from "@/components/panel/panel-shell";
import "../nexus.css";
import "../nexus-panel.css";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <PanelShell>{children}</PanelShell>
    </AuthGuard>
  );
}
