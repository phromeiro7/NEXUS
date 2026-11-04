import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LinkCodeDto } from "@aj/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { TelegramLink } from "./telegram-link";

const api = { createLinkCode: vi.fn(), unlinkTelegram: vi.fn() };
vi.mock("@/components/auth-provider", () => ({ useApi: () => api }));

const NOW = new Date("2026-10-31T12:00:00.000Z");
const TEN_MIN = 10 * 60 * 1000;

function dto(over: Partial<LinkCodeDto> = {}, ttl = TEN_MIN): LinkCodeDto {
  return {
    code: "ABC123XY",
    deepLink: "https://t.me/assistente_bot?start=ABC123XY",
    expiresAt: new Date(NOW.getTime() + ttl).toISOString(),
    ...over,
  };
}

function setup(props: { linked?: boolean; paused?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
  const ui = (p: { linked?: boolean; paused?: boolean }) => (
    <QueryClientProvider client={client}>
      <TelegramLink linked={p.linked ?? false} paused={p.paused ?? false} />
    </QueryClientProvider>
  );
  const view = render(ui(props));
  return {
    spy,
    rerender: (p: { linked?: boolean; paused?: boolean }) => view.rerender(ui(p)),
    unmount: view.unmount,
  };
}

const settingsCalls = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((c) => JSON.stringify(c[0]) === JSON.stringify({ queryKey: ["settings"] })).length;

async function generate() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Gerar código" }));
  });
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(NOW);
  api.createLinkCode.mockReset();
  api.unlinkTelegram.mockReset();
  api.createLinkCode.mockResolvedValue(dto());
  api.unlinkTelegram.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TelegramLink não vinculado", () => {
  it("gerar mostra o código e o link para o Telegram", async () => {
    setup();
    await generate();
    expect(api.createLinkCode).toHaveBeenCalledTimes(1);
    const code = screen.getByText("ABC123XY");
    expect(code).toBeInTheDocument();
    expect(code).toHaveAttribute("aria-label", "Código de vínculo: A B C 1 2 3 X Y");
    const link = screen.getByRole("link", { name: "Abrir no Telegram" });
    expect(link).toHaveAttribute("href", "https://t.me/assistente_bot?start=ABC123XY");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("Se preferir, envie ao bot: /start ABC123XY")).toBeInTheDocument();
    expect(screen.getByText("O código vale por 10 minutos e só pode ser usado uma vez.")).toBeInTheDocument();
  });

  it.each(["javascript:alert(1)", "https://evil.example/", "http://t.me/x"])(
    "omite o link quando deepLink é %s, mas mostra o código",
    async (deepLink) => {
      api.createLinkCode.mockResolvedValue(dto({ deepLink }));
      setup();
      await generate();
      expect(screen.getByText("ABC123XY")).toBeInTheDocument();
      expect(screen.queryByRole("link")).toBeNull();
    },
  );

  it("contagem regressiva visível: 10:00 e depois 8:59 após 61 s", async () => {
    setup();
    await generate();
    expect(screen.getByText("Válido por 10:00")).toBeInTheDocument();
    await advance(61_000);
    expect(screen.getByText("Válido por 8:59")).toBeInTheDocument();
  });

  it("o valor que muda a cada segundo não é anunciado (aria-hidden)", async () => {
    setup();
    await generate();
    expect(screen.getByText("Válido por 10:00").closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("ao vencer, esconde o código, avisa e para o polling", async () => {
    api.createLinkCode.mockResolvedValue(dto({}, TEN_MIN + 1000));
    const { spy } = setup();
    await generate();
    await advance(TEN_MIN);
    expect(screen.getByText("ABC123XY")).toBeInTheDocument();
    await advance(1000);
    expect(screen.queryByText("ABC123XY")).toBeNull();
    expect(screen.queryByRole("link", { name: "Abrir no Telegram" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("O código expirou. Gere outro.");
    const calls = settingsCalls(spy);
    await advance(30_000);
    expect(settingsCalls(spy)).toBe(calls);
    expect(screen.getByRole("button", { name: "Gerar código" })).toBeInTheDocument();
  });

  it("atualiza as configurações a cada 5 s enquanto o código vale", async () => {
    const { spy } = setup();
    await generate();
    expect(settingsCalls(spy)).toBe(0);
    await advance(15_000);
    expect(settingsCalls(spy)).toBe(3);
  });

  it("muda para o estado vinculado quando as configurações mudam e para o polling", async () => {
    const { spy, rerender } = setup();
    await generate();
    await advance(5000);
    rerender({ linked: true });
    expect(screen.getByText("Telegram vinculado")).toBeInTheDocument();
    expect(screen.queryByText("ABC123XY")).toBeNull();
    const calls = settingsCalls(spy);
    await advance(20_000);
    expect(settingsCalls(spy)).toBe(calls);
  });

  it("Gerar outro código troca o código e reinicia a contagem", async () => {
    setup();
    await generate();
    await advance(120_000);
    expect(screen.getByText("Válido por 8:00")).toBeInTheDocument();
    api.createLinkCode.mockResolvedValue(
      dto({ code: "NEWCODE9", deepLink: "https://t.me/assistente_bot?start=NEWCODE9", expiresAt: new Date(Date.now() + TEN_MIN).toISOString() }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Gerar outro código" }));
    });
    expect(screen.queryByText("ABC123XY")).toBeNull();
    expect(screen.getByText("NEWCODE9")).toBeInTheDocument();
    expect(screen.getByText("Válido por 10:00")).toBeInTheDocument();
  });

  it("copiar: sucesso", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    setup();
    await generate();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copiar código" }));
    });
    expect(writeText).toHaveBeenCalledWith("ABC123XY");
    expect(screen.getByRole("status")).toHaveTextContent("Código copiado.");
  });

  it("copiar: falha", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("negado"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    setup();
    await generate();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copiar código" }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("Não foi possível copiar.");
  });

  it("sem navigator.clipboard não há botão de copiar", async () => {
    vi.stubGlobal("navigator", {});
    setup();
    await generate();
    expect(screen.queryByRole("button", { name: "Copiar código" })).toBeNull();
  });

  it("erro 503 aparece em alert com a mensagem exata e preserva o estado", async () => {
    setup();
    await generate();
    api.createLinkCode.mockRejectedValue(new ApiError(503, "telegram_nao_configurado", { error: "telegram_nao_configurado" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Gerar outro código" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("O Telegram ainda não está configurado neste servidor.");
    expect(screen.getByText("ABC123XY")).toBeInTheDocument();
  });

  it("erro na primeira geração mantém o botão Gerar código", async () => {
    api.createLinkCode.mockRejectedValue(new ApiError(503, "telegram_nao_configurado", null));
    setup();
    await generate();
    expect(screen.getByRole("alert")).toHaveTextContent("O Telegram ainda não está configurado neste servidor.");
    expect(screen.getByRole("button", { name: "Gerar código" })).toBeInTheDocument();
  });

  it("duplo clique em Gerar código faz uma só chamada", async () => {
    let resolve: (v: LinkCodeDto) => void = () => {};
    api.createLinkCode.mockReturnValue(new Promise((r) => (resolve = r)));
    setup();
    const button = screen.getByRole("button", { name: "Gerar código" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.createLinkCode).toHaveBeenCalledTimes(1);
    await act(async () => resolve(dto()));
    expect(screen.getByText("ABC123XY")).toBeInTheDocument();
  });

  it("desmontar limpa os timers (sem chamadas depois)", async () => {
    const { spy, unmount } = setup();
    await generate();
    await advance(5000);
    const calls = settingsCalls(spy);
    unmount();
    await advance(60_000);
    expect(settingsCalls(spy)).toBe(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("não registra código nem segredo no console", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
    setup();
    await generate();
    await advance(10_000);
    for (const l of logs) expect(JSON.stringify(l.mock.calls)).not.toContain("ABC123XY");
  });
});

describe("TelegramLink vinculado", () => {
  it("mostra o estado, a explicação e Desvincular", () => {
    setup({ linked: true });
    expect(screen.getByText("Telegram vinculado")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Responda a qualquer confirmação do bot para alterar aquela tarefa. Para parar de receber mensagens, desvincule.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gerar código" })).toBeNull();
  });

  it("cancelar não chama a API", () => {
    setup({ linked: true });
    fireEvent.click(screen.getByRole("button", { name: "Desvincular" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(api.unlinkTelegram).not.toHaveBeenCalled();
  });

  it("confirmar chama a API uma vez (mesmo com duplo clique) e invalida ['settings']", async () => {
    let resolve: () => void = () => {};
    api.unlinkTelegram.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    const { spy } = setup({ linked: true });
    fireEvent.click(screen.getByRole("button", { name: "Desvincular" }));
    expect(api.unlinkTelegram).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Sim, desvincular" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(api.unlinkTelegram).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    await act(async () => resolve());
    expect(spy).toHaveBeenCalledWith({ queryKey: ["settings"] });
  });

  it("fecha o diálogo e devolve o foco a um elemento montado após desvincular", async () => {
    setup({ linked: true });
    fireEvent.click(screen.getByRole("button", { name: "Desvincular" }));
    const dialog = document.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sim, desvincular" }));
    });
    expect(dialog.open).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.isConnected).toBe(true);
    expect(screen.getByTestId("telegram-link")).toBe(document.activeElement);
  });

  it("erro ao desvincular aparece em alert e mantém o estado vinculado", async () => {
    api.unlinkTelegram.mockRejectedValue(new ApiError(0, "rede", null));
    const { spy } = setup({ linked: true });
    fireEvent.click(screen.getByRole("button", { name: "Desvincular" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sim, desvincular" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Sem conexão com o servidor.");
    expect(screen.getByText("Telegram vinculado")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("TelegramLink pausado", () => {
  const MSG = "O envio está pausado (bot bloqueado). Gere um novo código para retomar.";

  it("mostra o alerta quando não vinculado", () => {
    setup({ paused: true });
    expect(screen.getByRole("alert")).toHaveTextContent(MSG);
  });

  it("vinculado e pausado: alerta, Desvincular e Gerar código juntos", () => {
    setup({ linked: true, paused: true });
    expect(screen.getByRole("alert").textContent).toBe(MSG);
    expect(screen.getByRole("button", { name: "Desvincular" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gerar código" })).toBeInTheDocument();
  });

  it("vinculado e pausado: gerar mostra código, link, contagem e faz polling", async () => {
    const { spy } = setup({ linked: true, paused: true });
    await generate();
    expect(screen.getByText("ABC123XY")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir no Telegram" })).toHaveAttribute(
      "href",
      "https://t.me/assistente_bot?start=ABC123XY",
    );
    expect(screen.getByText("Válido por 10:00")).toBeInTheDocument();
    await advance(10_000);
    expect(settingsCalls(spy)).toBe(2);
  });

  it("depois de consumir o código (paused: false) volta ao estado vinculado simples", async () => {
    const { rerender } = setup({ linked: true, paused: true });
    await generate();
    rerender({ linked: true, paused: false });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("ABC123XY")).toBeNull();
    expect(screen.queryByRole("button", { name: "Gerar código" })).toBeNull();
    expect(screen.getByText("Telegram vinculado")).toBeInTheDocument();
  });

  it("sem pausa não há alerta", () => {
    setup();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
