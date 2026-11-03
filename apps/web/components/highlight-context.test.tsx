import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HighlightProvider, useHighlight } from "./highlight-context";

function Probe() {
  const { highlight, isHighlighted } = useHighlight();
  return (
    <div>
      <button onClick={() => highlight(["a"])}>marcar-a</button>
      <button onClick={() => highlight(["b"])}>marcar-b</button>
      <p>a:{String(isHighlighted("a"))}</p>
      <p>b:{String(isHighlighted("b"))}</p>
    </div>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("HighlightProvider", () => {
  it("marca os ids por 8 segundos e depois os solta", () => {
    render(
      <HighlightProvider>
        <Probe />
      </HighlightProvider>,
    );
    expect(screen.getByText("a:false")).toBeInTheDocument();
    act(() => screen.getByText("marcar-a").click());
    expect(screen.getByText("a:true")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(7_999));
    expect(screen.getByText("a:true")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByText("a:false")).toBeInTheDocument();
  });

  it("cada id expira no seu prazo e remarcar renova o prazo", () => {
    render(
      <HighlightProvider>
        <Probe />
      </HighlightProvider>,
    );
    act(() => screen.getByText("marcar-a").click());
    act(() => void vi.advanceTimersByTime(5_000));
    act(() => screen.getByText("marcar-b").click());
    act(() => screen.getByText("marcar-a").click());
    act(() => void vi.advanceTimersByTime(7_000));
    expect(screen.getByText("a:true")).toBeInTheDocument();
    expect(screen.getByText("b:true")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1_000));
    expect(screen.getByText("a:false")).toBeInTheDocument();
    expect(screen.getByText("b:false")).toBeInTheDocument();
  });

  it("sem provedor nada fica marcado", () => {
    render(<Probe />);
    expect(screen.getByText("a:false")).toBeInTheDocument();
  });

  it("limpa os temporizadores ao desmontar", () => {
    const { unmount } = render(
      <HighlightProvider>
        <Probe />
      </HighlightProvider>,
    );
    act(() => screen.getByText("marcar-a").click());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
