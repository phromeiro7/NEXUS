import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeTask } from "@/test/factories";
import { TaskRow } from "./task-row";

const today = "2026-10-27";

describe("TaskRow", () => {
  it("mostra a hora HH:mm quando existe", () => {
    render(<TaskRow task={makeTask({ dueTime: "14:30" })} today={today} onChange={vi.fn()} />);
    expect(screen.getByText("14:30")).toBeInTheDocument();
    expect(screen.queryByText("Dia inteiro")).toBeNull();
  });

  it("mostra Dia inteiro sem hora", () => {
    render(<TaskRow task={makeTask()} today={today} onChange={vi.fn()} />);
    expect(screen.getByText("Dia inteiro")).toBeInTheDocument();
  });

  it("mostra Fatal em texto, tipo e urgência", () => {
    render(
      <TaskRow task={makeTask({ fatal: true, type: "prazo", title: "Recurso" })} today={today} onChange={vi.fn()} />,
    );
    expect(screen.getByText("Fatal")).toBeInTheDocument();
    expect(screen.getByText("Prazo")).toBeInTheDocument();
    expect(screen.getByText("vence hoje")).toBeInTheDocument();
    expect(screen.getByText("Recurso")).toBeInTheDocument();
  });

  it("rotula audiência", () => {
    render(<TaskRow task={makeTask({ type: "audiencia" })} today={today} onChange={vi.fn()} />);
    expect(screen.getByText("Audiência")).toBeInTheDocument();
  });
});
