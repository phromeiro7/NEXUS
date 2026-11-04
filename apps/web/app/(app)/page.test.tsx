import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Home from "./page";

let v: string | null = null;
let d: string | null = null;
vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    const q = new URLSearchParams();
    if (v) q.set("v", v);
    if (d) q.set("d", d);
    return q;
  },
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/components/day-view", () => ({ DayView: ({ date }: { date: string | null }) => <p>dia-view {date ?? "hoje"}</p> }));
vi.mock("@/components/week-view", () => ({ WeekView: ({ anchor }: { anchor: string | null }) => <p>semana-view {anchor ?? "hoje"}</p> }));
vi.mock("@/components/month-view", () => ({
  MonthView: ({ year, month }: { year?: number; month?: number }) => <p>mes-view {year ?? "hoje"}-{month ?? "hoje"}</p>,
}));
vi.mock("@/components/quick-add", () => ({ QuickAdd: () => <p>adicao-rapida</p> }));
vi.mock("@/components/briefing-card", () => ({ BriefingCard: () => <p>briefing-card</p> }));
vi.mock("@/components/summary-aside", () => ({ SummaryAside: () => <aside>resumo</aside> }));

describe("Painel", () => {
  it("visão Dia por padrão", () => {
    v = null;
    d = null;
    render(<Home />);
    expect(screen.getByText("dia-view hoje")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dia" })).toHaveAttribute("aria-pressed", "true");
  });

  it("o briefing fica acima da adição rápida e da visão", () => {
    v = null;
    d = null;
    render(<Home />);
    const b = screen.getByText("briefing-card");
    expect(b.compareDocumentPosition(screen.getByText("adicao-rapida")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(b.compareDocumentPosition(screen.getByText("dia-view hoje")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Semana e Mês recebem a data de ?d=", () => {
    v = "semana";
    d = "2026-12-30";
    const { unmount } = render(<Home />);
    expect(screen.getByText("semana-view 2026-12-30")).toBeInTheDocument();
    unmount();
    v = "mes";
    render(<Home />);
    expect(screen.getByText("mes-view 2026-12")).toBeInTheDocument();
  });

  it("?d= inválido é ignorado e Dia o repassa quando válido", () => {
    v = null;
    d = "2026-02-30";
    const { unmount } = render(<Home />);
    expect(screen.getByText("dia-view hoje")).toBeInTheDocument();
    unmount();
    d = "2026-02-11";
    render(<Home />);
    expect(screen.getByText("dia-view 2026-02-11")).toBeInTheDocument();
  });
});
