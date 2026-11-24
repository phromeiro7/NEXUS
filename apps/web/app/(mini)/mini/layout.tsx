import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { MiniGate } from "@/components/mini/mini-gate";
import { MiniShell } from "@/components/mini/mini-shell";
import "../../nexus.css";

export const metadata: Metadata = { title: "Nexus" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

/** Layout do Mini App do Telegram: a porta de entrada (MiniGate) envolve a casca com abas. */
export default function MiniLayout({ children }: { children: ReactNode }) {
  return (
    <MiniGate>
      <MiniShell>{children}</MiniShell>
    </MiniGate>
  );
}
