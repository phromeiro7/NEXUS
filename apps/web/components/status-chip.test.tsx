import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    fireEvent.click(screen.getByRole("button", { name: "em andamento (X)" }));
    expect(onChange).toHaveBeenCalledWith("em_andamento");
  });

  it("o nome acessível de cada botão contém o texto visível (WCAG 2.5.3)", () => {
    render(<StatusChip task={makeTask({ title: "X", status: "concluida" })} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Alterar status de X" }));
    const reopen = screen.getByText("Reabrir como pendente");
    expect(reopen.getAttribute("aria-label")).toContain("Reabrir como pendente");
    expect(reopen.getAttribute("aria-label")).toContain("X");
    for (const b of screen.getAllByRole("button")) {
      const visible = (b.textContent ?? "").trim();
      expect(b.getAttribute("aria-label") ?? visible).toContain(visible);
    }
  });

  it("liga o botão ao menu com aria-controls e aria-expanded", () => {
    render(<StatusChip task={makeTask({ title: "X" })} onChange={vi.fn()} />);
    const toggle = screen.getByRole("button", { name: "Alterar status de X" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).not.toHaveAttribute("aria-controls");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const id = toggle.getAttribute("aria-controls");
    expect(id).toBeTruthy();
    expect(document.getElementById(id as string)).toBeInTheDocument();
  });

  it("Escape fecha o menu e devolve o foco ao botão", async () => {
    const user = userEvent.setup();
    render(<StatusChip task={makeTask({ title: "X" })} onChange={vi.fn()} />);
    const toggle = screen.getByRole("button", { name: "Alterar status de X" });
    await user.click(toggle);
    expect(screen.getByRole("list")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("list")).toBeNull();
    expect(toggle).toHaveFocus();
  });

  it("clique fora fecha o menu; clique dentro do chip não", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <StatusChip task={makeTask({ title: "X" })} onChange={vi.fn()} />
        <p>fora</p>
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Alterar status de X" }));
    await user.click(screen.getByText(/^Status:/));
    expect(screen.getByRole("list")).toBeInTheDocument();
    await user.click(screen.getByText("fora"));
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("botões têm alvo de toque de pelo menos 40 px (min-h-10)", () => {
    render(<StatusChip task={makeTask({ title: "X" })} onChange={vi.fn()} />);
    for (const b of screen.getAllByRole("button")) expect(b.className).toContain("min-h-10");
  });

  it("concluída nunca oferece em andamento nem Concluir", () => {
    render(<StatusChip task={makeTask({ title: "X", status: "concluida" })} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Concluir/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Alterar status de X" }));
    expect(screen.queryByRole("button", { name: /em andamento/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Reabrir como pendente (X)" })).toBeInTheDocument();
  });
});
