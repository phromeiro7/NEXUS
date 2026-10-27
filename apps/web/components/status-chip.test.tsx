import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeTask } from "@/test/factories";
import { StatusChip } from "./status-chip";

describe("StatusChip", () => {
  it("Concluir chama onChange com concluida", () => {
    const onChange = vi.fn();
    render(<StatusChip task={makeTask({ title: "Contestação" })} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Concluir Contestação" }));
    expect(onChange).toHaveBeenCalledWith("concluida");
  });

  it("oferece só as próximas opções válidas", () => {
    const onChange = vi.fn();
    render(<StatusChip task={makeTask({ title: "X" })} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Alterar status de X" }));
    fireEvent.click(screen.getByRole("button", { name: "Marcar X como em andamento" }));
    expect(onChange).toHaveBeenCalledWith("em_andamento");
  });

  it("concluída nunca oferece em andamento nem Concluir", () => {
    render(<StatusChip task={makeTask({ title: "X", status: "concluida" })} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Concluir/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Alterar status de X" }));
    expect(screen.queryByRole("button", { name: /em andamento/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Marcar X como pendente" })).toBeInTheDocument();
  });
});
