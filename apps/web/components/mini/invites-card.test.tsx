import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { InvitesCard } from "./invites-card";

const summaryOf = (invites: Array<{ status: string }>) => ({
  total: invites.length,
  ativos: invites.filter((i) => i.status === "ativo").length,
  usados: invites.filter((i) => i.status === "usado").length,
  expirados: invites.filter((i) => i.status === "expirado").length,
  revogados: invites.filter((i) => i.status === "revogado").length,
});
const listOf = <T extends { status: string }>(invites: T[]) => ({ invites, summary: summaryOf(invites) });

const holder = vi.hoisted(() => ({
  api: { listInvites: vi.fn(), createInvite: vi.fn(), deleteInvite: vi.fn() },
}));
vi.mock("@/components/auth-provider", () => ({ useApi: () => holder.api }));

const invite = (over: Record<string, unknown> = {}) => ({
  label: null,
  code: "ABCDEFGHJKMN",
  link: "https://t.me/NexusAssitant_bot?start=ABCDEFGHJKMN",
  status: "ativo",
  createdAt: "2026-11-04T12:00:00.000Z",
  expiresAt: "2026-11-11T12:00:00.000Z",
  usedAt: null,
  ...over,
});

function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InvitesCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  holder.api.listInvites.mockReset();
  holder.api.createInvite.mockReset();
  holder.api.deleteInvite.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { Telegram?: unknown }).Telegram;
});

describe("InvitesCard", () => {
  it("não aparece para quem não é administrador (403) e não mostra nada enquanto carrega", async () => {
    holder.api.listInvites.mockRejectedValue(new ApiError(403, "proibido", { error: "proibido" }));
    const { container } = wrap();
    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(holder.api.listInvites).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("administrador sem convites vê o estado vazio", async () => {
    holder.api.listInvites.mockResolvedValue(listOf([]));
    wrap();
    expect(await screen.findByRole("heading", { name: "Convites" })).toBeInTheDocument();
    expect(screen.getByText("Nenhum convite ainda. Gere o primeiro acima.")).toBeInTheDocument();
  });

  it("gera o convite, mostra o link e avisa a validade", async () => {
    holder.api.listInvites.mockResolvedValue(listOf([]));
    holder.api.createInvite.mockResolvedValue(invite());
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: "Gerar convite" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Convite criado. Vale por 7 dias e abre uma conta só.");
    expect(screen.getByLabelText("Link do convite")).toHaveValue("https://t.me/NexusAssitant_bot?start=ABCDEFGHJKMN");
  });

  it("envia o nome digitado e mostra o nome na lista", async () => {
    holder.api.listInvites.mockResolvedValue(listOf([invite({ label: "Maria" })]));
    holder.api.createInvite.mockResolvedValue(invite({ label: "Maria" }));
    wrap();
    expect(await screen.findByText("Maria:")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Nome da pessoa/), "  Maria ");
    await userEvent.click(screen.getByRole("button", { name: "Gerar convite" }));
    await waitFor(() => expect(holder.api.createInvite).toHaveBeenCalledWith("Maria"));
  });

  it("sem nome, gera o convite sem nome", async () => {
    holder.api.listInvites.mockResolvedValue(listOf([]));
    holder.api.createInvite.mockResolvedValue(invite());
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: "Gerar convite" }));
    await waitFor(() => expect(holder.api.createInvite).toHaveBeenCalledWith(undefined));
  });

  it("copia o link", async () => {
    holder.api.listInvites.mockResolvedValue(listOf([]));
    holder.api.createInvite.mockResolvedValue(invite());
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: "Gerar convite" }));
    await userEvent.click(await screen.findByRole("button", { name: "Copiar link" }));
    expect(writeText).toHaveBeenCalledWith("https://t.me/NexusAssitant_bot?start=ABCDEFGHJKMN");
    expect(await screen.findByText("Link copiado.")).toBeInTheDocument();
  });

  it("falha ao copiar: orienta a selecionar o link", async () => {
    holder.api.listInvites.mockResolvedValue(listOf([]));
    holder.api.createInvite.mockResolvedValue(invite());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("x")) } });
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: "Gerar convite" }));
    await userEvent.click(await screen.findByRole("button", { name: "Copiar link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Selecione o link e copie");
  });

  it("dentro do Telegram, Compartilhar abre a tela de compartilhar dele", async () => {
    holder.api.listInvites.mockResolvedValue(listOf([]));
    holder.api.createInvite.mockResolvedValue(invite());
    const openTelegramLink = vi.fn();
    (window as { Telegram?: unknown }).Telegram = { WebApp: { platform: "ios", openTelegramLink } };
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: "Gerar convite" }));
    await userEvent.click(await screen.findByRole("button", { name: "Compartilhar" }));
    expect(openTelegramLink).toHaveBeenCalledTimes(1);
    const url = new URL(openTelegramLink.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe("https://t.me/share/url");
    expect(url.searchParams.get("url")).toBe("https://t.me/NexusAssitant_bot?start=ABCDEFGHJKMN");
  });

  it("lista os convites com o estado em palavras e todos têm Apagar e só os ativos compartilham", async () => {
    holder.api.listInvites.mockResolvedValue(listOf([
        invite(),
        invite({ code: "BBBBBBBBBBBB", status: "usado", usedAt: "2026-11-05T10:00:00.000Z" }),
        invite({ code: "CCCCCCCCCCCC", status: "expirado" }),
        invite({ code: "DDDDDDDDDDDD", status: "revogado" }),
      ]));
    wrap();
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent("Ativo, vale até 11/11");
    expect(items[1]).toHaveTextContent("Usado em 05/11");
    expect(items[2]).toHaveTextContent("Expirou em 11/11");
    expect(items[3]).toHaveTextContent("Revogado");
    expect(screen.getAllByRole("button", { name: /^Apagar o convite/ })).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: "Compartilhar" })).toHaveLength(1);
    expect(screen.getByTestId("invites-summary")).toHaveTextContent("4 convites gerados: 1 ativo, 1 usado, 1 expirado, 1 revogado");
  });

  it("apagar pede confirmação e depois chama a API", async () => {
    holder.api.listInvites.mockResolvedValue(listOf([invite()]));
    holder.api.deleteInvite.mockResolvedValue(undefined);
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: "Apagar o convite ABCDEFGHJKMN" }));
    expect(holder.api.deleteInvite).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Sim, apagar" }));
    await waitFor(() => expect(holder.api.deleteInvite).toHaveBeenCalledWith("ABCDEFGHJKMN"));
    expect(await screen.findByText("Convite apagado.")).toBeInTheDocument();
  });

  it("apagar um convite usado avisa que a pessoa perde o acesso", async () => {
    holder.api.listInvites.mockResolvedValue(listOf([invite({ status: "usado", usedAt: "2026-11-05T10:00:00.000Z" })]));
    holder.api.deleteInvite.mockResolvedValue(undefined);
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: "Apagar o convite ABCDEFGHJKMN" }));
    expect(screen.getByText(/perde o acesso ao Nexus agora/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sim, apagar" }));
    expect(await screen.findByText("Convite apagado. A pessoa perdeu o acesso.")).toBeInTheDocument();
  });

  it("cancelar a exclusão não chama a API", async () => {
    holder.api.listInvites.mockResolvedValue(listOf([invite()]));
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: "Apagar o convite ABCDEFGHJKMN" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(holder.api.deleteInvite).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Apagar o convite ABCDEFGHJKMN" })).toBeInTheDocument();
  });

  it("erro ao gerar: avisa e deixa tentar de novo", async () => {
    holder.api.listInvites.mockResolvedValue(listOf([]));
    holder.api.createInvite.mockRejectedValue(new ApiError(500, "erro_interno", null));
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: "Gerar convite" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Algo deu errado");
    expect(screen.getByRole("button", { name: "Gerar convite" })).toBeEnabled();
  });

  it("erro ao carregar a lista: avisa com 'Tentar de novo'", async () => {
    holder.api.listInvites.mockRejectedValueOnce(new ApiError(500, "erro_interno", null));
    holder.api.listInvites.mockResolvedValue(listOf([invite()]));
    wrap();
    expect(await screen.findByText("Não foi possível carregar os convites.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText(/Ativo, vale até/)).toBeInTheDocument();
  });
});
