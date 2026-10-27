import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Home from "./page";

let v: string | null = null;
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(v ? `v=${v}` : ""),
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/components/day-view", () => ({ DayView: () => <p>dia-view</p> }));
vi.mock("@/components/summary-aside", () => ({ SummaryAside: () => <aside>resumo</aside> }));

describe("Painel", () => {
  it("visão Dia por padrão", () => {
    v = null;
    render(<Home />);
    expect(screen.getByText("dia-view")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dia" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Semana mostra aviso de construção", () => {
    v = "semana";
    render(<Home />);
    expect(screen.getByText(/em construção/)).toBeInTheDocument();
  });
});
