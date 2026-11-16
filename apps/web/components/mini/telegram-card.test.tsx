import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramCard } from "./telegram-card";

const holder = vi.hoisted(() => ({
  api: {
    createLinkCode: vi.fn(),
    unlinkTelegram: vi.fn(),
  },
}));
vi.mock("@/components/auth-provider", () => ({ useApi: () => holder.api }));

function wrap(linked: boolean, paused: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TelegramCard linked={linked} paused={paused} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  holder.api.createLinkCode.mockReset();
  holder.api.unlinkTelegram.mockReset();
});

describe("TelegramCard", () => {
  it("sem vínculo: gera o código e mostra o link e o comando", async () => {
    holder.api.createLinkCode.mockResolvedValue({
      code: "ABCD2345",
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      deepLink: "https://t.me/nexus_bot?start=ABCD2345",
    });
    wrap(false, false);
    expect(screen.getByText(/Ainda não conectado/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Gerar código" }));
    expect(await screen.findByLabelText(/Código de vínculo: A B C D 2 3 4 5/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir no Telegram" })).toHaveAttribute(
      "href",
      "https://t.me/nexus_bot?start=ABCD2345",
    );
    expect(screen.getByText("Se preferir, envie ao bot: /start ABCD2345")).toBeInTheDocument();
  });

  it("não abre um link que não seja do Telegram", async () => {
    holder.api.createLinkCode.mockResolvedValue({
      code: "ABCD2345",
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      deepLink: "https://exemplo.com/x",
    });
    wrap(false, false);
    await userEvent.click(screen.getByRole("button", { name: "Gerar código" }));
    await screen.findByLabelText(/Código de vínculo/);
    expect(screen.queryByRole("link", { name: "Abrir no Telegram" })).not.toBeInTheDocument();
  });

  it("vinculado: mostra o estado e só desvincula depois de confirmar", async () => {
    holder.api.unlinkTelegram.mockResolvedValue(undefined);
    wrap(true, false);
    expect(screen.getByText("Telegram vinculado")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Desvincular" }));
    expect(holder.api.unlinkTelegram).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Sim, desvincular" }));
    await waitFor(() => expect(holder.api.unlinkTelegram).toHaveBeenCalledTimes(1));
  });

  it("cancelar a confirmação não desvincula", async () => {
    wrap(true, false);
    await userEvent.click(screen.getByRole("button", { name: "Desvincular" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(holder.api.unlinkTelegram).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Desvincular" })).toBeInTheDocument();
  });

  it("vinculado e pausado: avisa e oferece um código novo", () => {
    wrap(true, true);
    expect(screen.getByRole("alert")).toHaveTextContent("O envio está pausado (bot bloqueado). Gere um novo código para retomar.");
    expect(screen.getByRole("button", { name: "Gerar código" })).toBeInTheDocument();
    expect(screen.getByText("Telegram vinculado")).toBeInTheDocument();
  });

  it("falha ao gerar o código: mostra o erro", async () => {
    holder.api.createLinkCode.mockRejectedValue(new Error("falhou"));
    wrap(false, false);
    await userEvent.click(screen.getByRole("button", { name: "Gerar código" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
