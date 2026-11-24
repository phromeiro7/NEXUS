"use client";

import Script from "next/script";
import { useCallback, useEffect } from "react";
import { OUTSIDE_TELEGRAM_PLATFORM } from "@/lib/telegram-init";

/** Parte da API `window.Telegram.WebApp` que o Mini App usa. */
type WebApp = {
  ready(): void;
  expand(): void;
  platform?: string;
  /** O que o Telegram assinou para este uso do app; nunca exibir nem registrar. */
  initData?: string;
  initDataUnsafe?: { user?: { first_name?: string } };
  colorScheme: "light" | "dark";
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  /** Abre um link t.me (ex.: a tela de compartilhar) sem sair do app. */
  openTelegramLink?(url: string): void;
  onEvent?(event: string, cb: () => void): void;
  offEvent?(event: string, cb: () => void): void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

/** Cor de fundo do app em cada tema; o cabeçalho e o fundo do Telegram usam a mesma para não haver emenda. */
const BACKGROUND_COLOR = { light: "#f5f6f2", dark: "#0e1f28" } as const;

/**
 * Carrega o SDK do Telegram quando o app abre dentro dele e informa só o esquema claro/escuro.
 * Fora do Telegram nada acontece e vale prefers-color-scheme.
 */
export function TelegramBridge({ onColorSchemeChange }: { onColorSchemeChange: (scheme: "light" | "dark") => void }) {
  /** Avisa o Telegram que o app está pronto, abre em tela cheia e acompanha o tema. Devolve a limpeza. */
  const attachToTelegram = useCallback(() => {
    const webApp = window.Telegram?.WebApp;
    // Fora do Telegram o SDK carrega mesmo assim (platform "unknown"): vale prefers-color-scheme.
    if (!webApp || webApp.platform === OUTSIDE_TELEGRAM_PLATFORM) return () => {};
    const applyColorScheme = () => {
      onColorSchemeChange(webApp.colorScheme);
      webApp.setHeaderColor?.(BACKGROUND_COLOR[webApp.colorScheme]);
      webApp.setBackgroundColor?.(BACKGROUND_COLOR[webApp.colorScheme]);
    };
    webApp.ready();
    webApp.expand();
    applyColorScheme();
    webApp.onEvent?.("themeChanged", applyColorScheme);
    return () => webApp.offEvent?.("themeChanged", applyColorScheme);
  }, [onColorSchemeChange]);

  // Cobre o caso de o SDK já estar carregado (navegação no cliente); o onReady do Script cobre a primeira carga.
  useEffect(() => attachToTelegram(), [attachToTelegram]);

  return (
    <Script
      src="https://telegram.org/js/telegram-web-app.js"
      strategy="afterInteractive"
      onReady={() => void attachToTelegram()}
    />
  );
}

/** Primeiro nome da pessoa no Telegram, só para sugerir; vazio fora do Telegram. */
export function telegramFirstName(): string {
  const webApp = typeof window === "undefined" ? undefined : window.Telegram?.WebApp;
  if (!webApp || webApp.platform === OUTSIDE_TELEGRAM_PLATFORM) return "";
  // initDataUnsafe não é verificado: serve só para sugerir o nome, nunca para autenticar.
  return webApp.initDataUnsafe?.user?.first_name?.trim() ?? "";
}
