"use client";

import Script from "next/script";
import { useCallback, useEffect } from "react";

type WebApp = {
  ready(): void;
  expand(): void;
  platform?: string;
  initDataUnsafe?: { user?: { first_name?: string } };
  colorScheme: "light" | "dark";
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  onEvent?(event: string, cb: () => void): void;
  offEvent?(event: string, cb: () => void): void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

const BG = { light: "#f5f6f2", dark: "#0e1f28" } as const;

/**
 * Carrega o SDK do Telegram quando o app abre dentro dele e informa só o esquema claro/escuro.
 * Fora do Telegram nada acontece e vale prefers-color-scheme.
 */
export function TelegramBridge({ onScheme }: { onScheme: (scheme: "light" | "dark") => void }) {
  const attach = useCallback(() => {
    const app = window.Telegram?.WebApp;
    // Fora do Telegram o SDK carrega mesmo assim (platform "unknown"): vale prefers-color-scheme.
    if (!app || app.platform === "unknown") return () => {};
    const apply = () => {
      onScheme(app.colorScheme);
      app.setHeaderColor?.(BG[app.colorScheme]);
      app.setBackgroundColor?.(BG[app.colorScheme]);
    };
    app.ready();
    app.expand();
    apply();
    app.onEvent?.("themeChanged", apply);
    return () => app.offEvent?.("themeChanged", apply);
  }, [onScheme]);

  useEffect(() => attach(), [attach]);

  return (
    <Script
      src="https://telegram.org/js/telegram-web-app.js"
      strategy="afterInteractive"
      onReady={() => void attach()}
    />
  );
}

/** Primeiro nome da pessoa no Telegram, só para sugerir; vazio fora do Telegram. */
export function telegramFirstName(): string {
  const app = typeof window === "undefined" ? undefined : window.Telegram?.WebApp;
  if (!app || app.platform === "unknown") return "";
  return app.initDataUnsafe?.user?.first_name?.trim() ?? "";
}
