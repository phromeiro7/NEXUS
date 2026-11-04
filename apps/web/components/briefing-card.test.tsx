import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BriefingDto } from "@aj/shared";
import { makeTask } from "@/test/factories";
import { BriefingCard } from "./briefing-card";

let state: { data?: BriefingDto; isPending: boolean; isError: boolean };
vi.mock("@/hooks/queries", () => ({ useBriefing: () => state }));

const empty: BriefingDto = { today: "2026-10-27", overdue: [], fatalToday: [], hearingsToday: [], nextTwoDays: [] };

beforeEach(() => {
  state = { data: empty, isPending: false, isError: false };
});

describe("BriefingCard", () => {
  it("não renderiza nada quando o briefing é vazio", () => {
    const { container } = render(<BriefingCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("não renderiza nada enquanto carrega ou em erro", () => {
    state = { isPending: true, isError: false };
    const a = render(<BriefingCard />);
    expect(a.container).toBeEmptyDOMElement();
    a.unmount();
    state = { isPending: false, isError: true };
    const b = render(<BriefingCard />);
    expect(b.container).toBeEmptyDOMElement();
  });

  it("mostra o texto simples do briefing com o título", () => {
    state = {
      isPending: false,
      isError: false,
      data: {
        ...empty,
        overdue: [makeTask({ id: "x", title: "Contestação", type: "prazo", dueDate: "2026-10-20" })],
        fatalToday: [makeTask({ id: "y", title: "Recurso", type: "prazo", fatal: true, dueTime: "17:00" })],
      },
    };
    render(<BriefingCard />);
    expect(screen.getByRole("heading", { name: "Briefing do dia" })).toBeInTheDocument();
    const pre = screen.getByTestId("briefing-text");
    expect(pre).toHaveStyle({ whiteSpace: "pre-line" });
    const lines = pre.textContent!.split("\n");
    expect(lines[0]).toBe("Bom dia.");
    expect(lines).toContain("Atrasadas (1)");
    expect(lines).toContain("• 20/10 — Contestação (Prazo)");
    expect(lines).toContain("Fatais de hoje (1)");
    expect(lines).toContain("• 17:00 — Recurso (Prazo, fatal)");
  });
});
