"use client";

import type { ReactNode } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { useAuth } from "@/components/auth-provider";

function Header() {
  const { signOut } = useAuth();
  return (
    <header className="flex items-center justify-between border-b border-[var(--color-borda)] bg-[var(--color-superficie)] px-4 py-2">
      <span className="font-semibold">Assistente Jurídico</span>
      <button
        type="button"
        onClick={() => void signOut()}
        className="rounded border border-[var(--color-borda)] px-3 py-1 text-sm"
      >
        Sair
      </button>
    </header>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <Header />
      {children}
    </AuthGuard>
  );
}
