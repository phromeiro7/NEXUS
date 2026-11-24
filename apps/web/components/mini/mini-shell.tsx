"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { MenuIcon, NexusMark } from "./icons";
import { TabBar } from "./tab-bar";
import { TelegramBridge } from "./telegram-bridge";
import { ToastProvider } from "./toast";

/** Casca do Mini App: cabeçalho, abas, avisos (toast) e a ponte com o tema do Telegram. */
export function MiniShell({ children }: { children: ReactNode }) {
  // Esquema claro/escuro vindo do Telegram; `undefined` deixa valer prefers-color-scheme.
  const [scheme, setScheme] = useState<"light" | "dark" | undefined>(undefined);
  return (
    <div className="mini" data-scheme={scheme}>
      <TelegramBridge onScheme={setScheme} />
      <ToastProvider>
        <div className="mini-wrap">
          <MiniHeader />
          {children}
        </div>
        <TabBar />
      </ToastProvider>
    </div>
  );
}

/** Cabeçalho com a marca (volta para Hoje) e o menu com Configurações e Sair. */
function MiniHeader() {
  const { signOut, displayName } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);

  // Com o menu aberto, Esc fecha (devolvendo o foco ao botão) e tocar fora dele também fecha.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleButtonRef.current?.focus();
    };
    const handlePointerDown = (event: Event) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  return (
    <header className="mini-head">
      <Link href="/mini" className="mini-brand" aria-label="Nexus, ir para Hoje">
        <NexusMark />
        <span>
          <b>nexus</b>
          <small>{displayName ? `Oi, ${displayName}` : "Seu dia, em ordem"}</small>
        </span>
      </Link>
      <div className="mini-menu" ref={menuRef}>
        <button
          ref={toggleButtonRef}
          type="button"
          className="mini-icon-btn"
          aria-label="Menu"
          aria-expanded={open}
          aria-controls="mini-menu-list"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
        >
          <MenuIcon />
        </button>
        {open && (
          <div id="mini-menu-list" className="mini-menu-list">
            <Link href="/mini/configuracoes" onClick={() => setOpen(false)}>
              Configurações
            </Link>
            <button type="button" onClick={() => void signOut()}>
              Sair
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
