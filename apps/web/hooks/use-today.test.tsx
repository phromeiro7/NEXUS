import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToday } from "./use-today";

let settings: { timezone: string } | undefined;
vi.mock("./queries", () => ({
  useSettings: () => ({ data: settings }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers();
  settings = { timezone: "America/Sao_Paulo" };
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useToday", () => {
  it("troca de dia na meia-noite do fuso configurado, sem recarregar", () => {
    vi.setSystemTime(new Date("2026-10-27T02:59:00Z"));
    const { result } = renderHook(() => useToday(), { wrapper });
    expect(result.current).toBe("2026-10-26");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(new Date().toISOString()).toBe("2026-10-27T03:00:00.000Z");
    expect(result.current).toBe("2026-10-27");
  });

  it("recalcula quando a aba volta ao foco", () => {
    vi.setSystemTime(new Date("2026-10-27T02:59:00Z"));
    const { result } = renderHook(() => useToday(), { wrapper });
    expect(result.current).toBe("2026-10-26");
    vi.setSystemTime(new Date("2026-10-27T03:00:30Z"));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current).toBe("2026-10-27");
  });

  it("recalcula em visibilitychange", () => {
    vi.setSystemTime(new Date("2026-10-27T02:59:00Z"));
    const { result } = renderHook(() => useToday(), { wrapper });
    vi.setSystemTime(new Date("2026-10-27T03:05:00Z"));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe("2026-10-27");
  });

  it("retorna null enquanto as configurações não carregaram", () => {
    settings = undefined;
    vi.setSystemTime(new Date("2026-10-27T02:59:00Z"));
    const { result } = renderHook(() => useToday(), { wrapper });
    expect(result.current).toBeNull();
  });

  it("limpa timers e listeners ao desmontar", () => {
    const removeWin = vi.spyOn(window, "removeEventListener");
    const removeDoc = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useToday(), { wrapper });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removeWin).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(removeDoc).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});
