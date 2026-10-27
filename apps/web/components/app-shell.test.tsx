import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
const signOut = vi.fn();
vi.mock("./auth-provider", () => ({ useAuth: () => ({ signOut }) }));

beforeEach(() => {
  pathname = "/";
  signOut.mockReset();
});

describe("AppShell", () => {
  it("marca o link ativo com aria-current", () => {
    pathname = "/historico";
    render(
      <AppShell>
        <p>conteúdo</p>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Histórico" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Painel" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Configurações" })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("conteúdo")).toBeInTheDocument();
  });

  it("Painel ativo em /", () => {
    render(<AppShell>x</AppShell>);
    expect(screen.getByRole("link", { name: "Painel" })).toHaveAttribute("aria-current", "page");
  });

  it("o botão sair chama signOut", () => {
    render(<AppShell>x</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
