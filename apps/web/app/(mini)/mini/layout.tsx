import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { MiniShell } from "@/components/mini/mini-shell";
import "../../nexus.css";

export const metadata: Metadata = { title: "Nexus" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function MiniLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <MiniShell>{children}</MiniShell>
    </AuthGuard>
  );
}
