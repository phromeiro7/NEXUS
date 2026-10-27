"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "./auth-provider";

const NAV = [
  { href: "/", label: "Painel" },
  { href: "/historico", label: "Histórico" },
  { href: "/configuracoes", label: "Configurações" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { signOut } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-borda)] bg-[var(--color-superficie)] px-4 py-2">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="font-semibold">Assistente Jurídico</span>
          <nav aria-label="Principal" className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {NAV.map(({ href, label }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded px-3 py-1 text-sm ${
                    active
                      ? "bg-[var(--color-destaque)] font-semibold text-[var(--color-superficie)]"
                      : "text-[var(--color-texto)] hover:underline"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded border border-[var(--color-borda)] px-3 py-1 text-sm"
          >
            Sair
          </button>
        </div>
        {/* Reservado para a barra de comando (Plano 4). */}
        <div data-slot="command-bar" />
      </header>
      {children}
    </div>
  );
}
