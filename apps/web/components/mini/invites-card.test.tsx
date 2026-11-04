import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { InvitesCard } from "./invites-card";

const holder = vi.hoisted(() => ({
  api: { listInvites: vi.fn(), createInvite: vi.fn(), revokeInvite: vi.fn() },
}));
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
  holder.api.revokeInvite.mockReset();
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
    holder.api.listInvites.mockResolvedValue({ invites: [] });
    wrap();
    expect(await screen.findByRole("heading", { name: "Convites" })).toBeInTheDocument();
    expect(screen.getByText("Nenhum convite ainda. Gere o primeiro acima.")).toBeInTheDocument();
  });

  it("gera o convite, mostra o link e avisa a validade", async () => {
    holder.api.listInvites.mockResolvedValue({ invites: [] });
    holder.api.createInvite.mockResolvedValue(invite());
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: "Gerar convite" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Convite criado. Vale por 7 dias e abre uma conta só.");
    expect(screen.getByLabelText("Link do convite")).toHaveValue("https://t.me/NexusAssitant_bot?start=ABCDEFGHJKMN");
  });

  it("copia o link", async () => {
    holder.api.listInvites.mockResolvedValue({ invites: [] });
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
    holder.api.listInvites.mockResolvedValue({ invites: [] });
    holder.api.createInvite.mockResolvedValue(invite());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("x")) } });
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: "Gerar convite" }));
    await userEvent.click(await screen.findByRole("button", { name: "Copiar link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Selecione o link e copie");
  });

  it("dentro do Telegram, Compartilhar abre a tela de compartilhar dele", async () => {
    holder.api.listInvites.mockResolvedValue({ invites: [] });
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

  it("lista os convites com o estado em palavras e só os ativos têm ações", async () => {
    holder.api.listInvites.mockResolvedValue({
      invites: [
        invite(),
        invite({ code: "BBBBBBBBBBBB", status: "usado", usedAt: "2026-11-05T10:00:00.000Z" }),
        invite({ code: "CCCCCCCCCCCC", status: "expirado" }),
        invite({ code: "DDDDDDDDDDDD", status: "revogado" }),
      ],
    });
    wrap();
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent("Ativo, vale até 11/11");
    expect(items[1]).toHaveTextContent("Usado em 05/11");
    expect(items[2]).toHaveTextContent("Expirou em 11/11");
    expect(items[3]).toHaveTextContent("Revogado");
    expect(screen.getAllByRole("button", { name: "Revogar" })).toHaveLength(1);
  });

  it("revogar pede confirmação e depois chama a API", async () => {
    holder.api.listInvites.mockResolvedValue({ invites: [invite()] });
    holder.api.revokeInvite.mockResolvedValue(undefined);
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: "Revogar" }));
    expect(holder.api.revokeInvite).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Sim, revogar" }));
    await waitFor(() => expect(holder.api.revokeInvite).toHaveBeenCalledWith("ABCDEFGHJKMN"));
    expect(await screen.findByText("Convite revogado.")).toBeInTheDocument();
  });

  it("cancelar a revogação não chama a API", async () => {
    holder.api.listInvites.mockResolvedValue({ invites: [invite()] });
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: "Revogar" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(holder.api.revokeInvite).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Revogar" })).toBeInTheDocument();
  });

  it("erro ao gerar: avisa e deixa tentar de novo", async () => {
    holder.api.listInvites.mockResolvedValue({ invites: [] });
    holder.api.createInvite.mockRejectedValue(new ApiError(500, "erro_interno", null));
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: "Gerar convite" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Algo deu errado");
    expect(screen.getByRole("button", { name: "Gerar convite" })).toBeEnabled();
  });

  it("erro ao carregar a lista: avisa com 'Tentar de novo'", async () => {
    holder.api.listInvites.mockRejectedValueOnce(new ApiError(500, "erro_interno", null));
    holder.api.listInvites.mockResolvedValue({ invites: [invite()] });
    wrap();
    expect(await screen.findByText("Não foi possível carregar os convites.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText(/Ativo, vale até/)).toBeInTheDocument();
  });
});
