import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { PanelShell } from "./panel-shell";

const summaryOf = (invites: Array<{ status: string }>) => ({
  total: invites.length,
  ativos: invites.filter((i) => i.status === "ativo").length,
  usados: invites.filter((i) => i.status === "usado").length,
  expirados: invites.filter((i) => i.status === "expirado").length,
  revogados: invites.filter((i) => i.status === "revogado").length,
});
const listOf = <T extends { status: string }>(invites: T[]) => ({ invites, summary: summaryOf(invites) });

const holder = vi.hoisted(() => ({
  pathname: "/",
  signOut: vi.fn(),
  displayName: "Ana" as string | null,
  api: { listInvites: vi.fn() },
}));
vi.mock("next/navigation", () => ({ usePathname: () => holder.pathname }));
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ displayName: holder.displayName, signOut: holder.signOut }),
  useApi: () => holder.api,
}));

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PanelShell>
        <p>conteúdo</p>
      </PanelShell>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  holder.pathname = "/";
  holder.displayName = "Ana";
  holder.signOut.mockReset();
  holder.api.listInvites.mockReset().mockResolvedValue(listOf([]));
});

describe("PanelShell", () => {
  it("tem o menu Hoje, Finanças e Configurações, com a página atual marcada", async () => {
    holder.pathname = "/financas";
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Seções" });
    expect(nav).toHaveTextContent("Hoje");
    expect(screen.getByRole("link", { name: "Finanças" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Hoje" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Configurações" })).toHaveAttribute("href", "/configuracoes");
    expect(screen.getByText("conteúdo")).toBeInTheDocument();
  });

  it("não tem Histórico nem nada do painel jurídico", () => {
    renderShell();
    expect(screen.queryByRole("link", { name: /histórico|calculadora|processos/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/jurídic/i)).not.toBeInTheDocument();
  });

  it("administrador vê Convites numa área de administração à parte", async () => {
    renderShell();
    const admin = await screen.findByRole("navigation", { name: "Administração" });
    expect(admin).toHaveTextContent("Convites");
    expect(screen.getByRole("link", { name: "Convites" })).toHaveAttribute("href", "/convites");
  });

  it("quem não administra (403) não vê Convites", async () => {
    holder.api.listInvites.mockRejectedValue(new ApiError(403, "proibido", null));
    renderShell();
    await waitFor(() => expect(holder.api.listInvites).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("navigation", { name: "Administração" })).not.toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Convites" })).not.toBeInTheDocument();
  });

  it("uma falha qualquer ao descobrir o perfil também esconde Convites", async () => {
    holder.api.listInvites.mockRejectedValue(new Error("rede"));
    renderShell();
    await waitFor(() => expect(holder.api.listInvites).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Convites" })).not.toBeInTheDocument();
  });

  it("mostra quem está usando e Sair encerra a sessão", async () => {
    renderShell();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sair" }));
    expect(holder.signOut).toHaveBeenCalledTimes(1);
  });

  it("sem nome salvo, saúda como 'Você'", () => {
    holder.displayName = null;
    renderShell();
    expect(screen.getByText("Você")).toBeInTheDocument();
  });

  it("lista os atalhos no rodapé do menu", () => {
    renderShell();
    const keys = screen.getByRole("group", { name: "Atalhos de teclado" });
    expect(keys).toHaveTextContent("Nova tarefa");
    expect(keys).toHaveTextContent("Anotar ou buscar");
    expect(keys).toHaveTextContent("Ver atalhos");
  });
});
