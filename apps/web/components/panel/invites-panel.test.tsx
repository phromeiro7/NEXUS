import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { InvitesPanel } from "./invites-panel";

const summaryOf = (invites: Array<{ status: string }>) => ({
  total: invites.length,
  ativos: invites.filter((i) => i.status === "ativo").length,
  usados: invites.filter((i) => i.status === "usado").length,
  expirados: invites.filter((i) => i.status === "expirado").length,
  revogados: invites.filter((i) => i.status === "revogado").length,
});
const listOf = <T extends { status: string }>(invites: T[]) => ({ invites, summary: summaryOf(invites) });

const holder = vi.hoisted(() => ({ api: { listInvites: vi.fn(), createInvite: vi.fn(), deleteInvite: vi.fn() } }));
vi.mock("@/components/auth-provider", () => ({ useApi: () => holder.api }));

const invite = (over: Record<string, unknown> = {}) => ({
  code: "ABCDEFGHJKMN",
  link: "https://t.me/NexusAssitant_bot?start=ABCDEFGHJKMN",
  status: "ativo",
  createdAt: "2026-11-04T12:00:00.000Z",
  expiresAt: "2026-11-11T12:00:00.000Z",
  usedAt: null,
  ...over,
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InvitesPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  holder.api.listInvites.mockReset().mockResolvedValue(listOf([]));
  holder.api.createInvite.mockReset();
  holder.api.deleteInvite.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("InvitesPanel", () => {
  it("quem não administra (403) vê um aviso gentil e um caminho de volta, sem ferramentas", async () => {
    holder.api.listInvites.mockRejectedValue(new ApiError(403, "proibido", null));
    renderPanel();
    expect(await screen.findByText("Só quem administra o Nexus vê esta página.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voltar para Hoje" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button", { name: "Gerar convite" })).not.toBeInTheDocument();
  });

  it("sem convites, convida a gerar o primeiro", async () => {
    renderPanel();
    expect(await screen.findByText("Nenhum convite ainda. Gere o primeiro acima.")).toBeInTheDocument();
  });

  it("Gerar convite mostra o link, copia e avisa", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    holder.api.createInvite.mockResolvedValue(invite());
    holder.api.listInvites.mockResolvedValueOnce(listOf([])).mockResolvedValue(listOf([invite()]));
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Gerar convite" }));
    expect(await screen.findByText("Convite criado.", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getAllByText(/Vale por 7 dias e abre uma conta só/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Link para enviar")).toHaveValue("https://t.me/NexusAssitant_bot?start=ABCDEFGHJKMN");
    await userEvent.click(screen.getByRole("button", { name: "Copiar link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://t.me/NexusAssitant_bot?start=ABCDEFGHJKMN"));
    expect(await screen.findByText("Link copiado.")).toBeInTheDocument();
  });

  it("a tabela lista todos os convites com a situação de cada um", async () => {
    holder.api.listInvites.mockResolvedValue(listOf([
        invite(),
        invite({ code: "USADOUSADO12", status: "usado", usedAt: "2026-11-05T10:00:00.000Z" }),
        invite({ code: "EXPIRADOEXP1", status: "expirado" }),
        invite({ code: "REVOGADOREV1", status: "revogado" }),
      ]));
    renderPanel();
    const table = await screen.findByRole("table", { name: "Convites gerados" });
    expect(within(table).getByText("Ativo, vale até 11/11")).toBeInTheDocument();
    expect(within(table).getByText("Usado em 05/11")).toBeInTheDocument();
    expect(within(table).getByText("Expirou em 11/11")).toBeInTheDocument();
    expect(within(table).getByText("Revogado")).toBeInTheDocument();
    // só o convite ativo tem ações
    expect(within(table).getAllByRole("button", { name: "Compartilhar" })).toHaveLength(1);
  });

  it("apagar pede confirmação e só então chama a API", async () => {
    holder.api.listInvites.mockResolvedValue(listOf([invite()]));
    holder.api.deleteInvite.mockResolvedValue(undefined);
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Apagar o convite ABCDEFGHJKMN" }));
    expect(holder.api.deleteInvite).not.toHaveBeenCalled();
    const group = screen.getByRole("group", { name: "Apagar este convite?" });
    await userEvent.click(within(group).getByRole("button", { name: "Sim, apagar" }));
    await waitFor(() => expect(holder.api.deleteInvite).toHaveBeenCalledWith("ABCDEFGHJKMN"));
    expect(await screen.findByText("Convite apagado.")).toBeInTheDocument();
  });

  it("falha ao gerar mostra o erro e falha ao listar oferece Tentar de novo", async () => {
    holder.api.createInvite.mockRejectedValue(new ApiError(503, "indisponivel", null));
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Gerar convite" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("erro de rede ao listar não é tratado como falta de permissão", async () => {
    holder.api.listInvites.mockRejectedValueOnce(new Error("rede")).mockResolvedValue(listOf([]));
    renderPanel();
    expect(await screen.findByText("Não foi possível carregar os convites.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Nenhum convite ainda. Gere o primeiro acima.")).toBeInTheDocument();
  });
});
