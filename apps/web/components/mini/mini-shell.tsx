"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { MenuIcon, NexusMark } from "./icons";
import { TabBar } from "./tab-bar";
import { TelegramBridge } from "./telegram-bridge";
import { ToastProvider } from "./toast";

export function MiniShell({ children }: { children: ReactNode }) {
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

function MiniHeader() {
  const { signOut, displayName } = useAuth();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    const onPointer = (e: Event) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
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
      <div className="mini-menu" ref={root}>
        <button
          ref={toggle}
          type="button"
          className="mini-icon-btn"
          aria-label="Menu"
          aria-expanded={open}
          aria-controls="mini-menu-list"
          onClick={() => setOpen((v) => !v)}
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
