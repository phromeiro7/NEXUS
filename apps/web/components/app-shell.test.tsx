import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("./command-bar", () => ({ CommandBar: () => <button type="button">barra-de-comando</button> }));
const signOut = vi.fn();
vi.mock("./auth-provider", () => ({ useAuth: () => ({ signOut }) }));

beforeEach(() => {
  pathname = "/";
  signOut.mockReset();
});

describe("AppShell alvos de toque", () => {
  it("links de navegação e Sair têm pelo menos 40 px de altura (min-h-10)", () => {
    render(<AppShell>x</AppShell>);
    for (const name of ["Painel", "Calculadora", "Histórico", "Configurações"]) {
      expect(screen.getByRole("link", { name }).className).toContain("min-h-10");
    }
    expect(screen.getByRole("button", { name: "Sair" }).className).toContain("min-h-10");
  });
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

  it("Calculadora aponta para /calculadora e fica ativa nela", () => {
    pathname = "/calculadora";
    render(<AppShell>x</AppShell>);
    const link = screen.getByRole("link", { name: "Calculadora" });
    expect(link).toHaveAttribute("href", "/calculadora");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Painel" })).not.toHaveAttribute("aria-current");
  });

  it("Painel ativo em /", () => {
    render(<AppShell>x</AppShell>);
    expect(screen.getByRole("link", { name: "Painel" })).toHaveAttribute("aria-current", "page");
  });

  it("monta a barra de comando no slot reservado do cabeçalho", () => {
    const { container } = render(<AppShell>x</AppShell>);
    const slot = container.querySelector('header [data-slot="command-bar"]')!;
    expect(slot).toContainElement(screen.getByRole("button", { name: "barra-de-comando" }));
  });

  it("o botão sair chama signOut", () => {
    render(<AppShell>x</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
