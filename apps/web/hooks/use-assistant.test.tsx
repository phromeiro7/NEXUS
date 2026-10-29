import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { useAssistant } from "./use-assistant";

const api = { sendAssistantMessage: vi.fn() };
vi.mock("@/components/auth-provider", () => ({ useApi: () => api }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const reply = { reply: "Feito.", affectedTasks: [] };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useAssistant(), { wrapper }), spy };
}

beforeEach(() => vi.resetAllMocks());

describe("useAssistant", () => {
  it("envia { text, clientMessageId } com UUID e sem userId, e invalida tarefas e briefing", async () => {
    api.sendAssistantMessage.mockResolvedValue(reply);
    const { result, spy } = setup();
    let out: unknown;
    await act(async () => {
      out = await result.current.send("  criar prazo  ");
    });
    expect(out).toEqual(reply);
    const body = api.sendAssistantMessage.mock.calls[0]![0];
    expect(Object.keys(body).sort()).toEqual(["clientMessageId", "text"]);
    expect(body.text).toBe("criar prazo");
    expect(body.clientMessageId).toMatch(UUID);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["tasks"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["briefing"] });
    expect(result.current.pending).toBe(false);
  });

  it("reusa o mesmo id ao reenviar o mesmo texto após erro e não invalida", async () => {
    api.sendAssistantMessage
      .mockRejectedValueOnce(new ApiError(0, "rede", null))
      .mockRejectedValueOnce(new ApiError(503, "assistente_indisponivel", { reason: "rede" }))
      .mockResolvedValueOnce(reply);
    const { result, spy } = setup();
    await act(async () => {
      await expect(result.current.send("olá")).rejects.toBeInstanceOf(ApiError);
    });
    expect(spy).not.toHaveBeenCalled();
    await act(async () => {
      await expect(result.current.send("olá")).rejects.toBeInstanceOf(ApiError);
    });
    await act(async () => {
      await result.current.send("olá");
    });
    const ids = api.sendAssistantMessage.mock.calls.map((c) => c[0].clientMessageId);
    expect(ids[0]).toMatch(UUID);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).toBe(ids[0]);
  });

  it("gera id novo após sucesso e quando o texto muda", async () => {
    api.sendAssistantMessage.mockRejectedValueOnce(new ApiError(0, "rede", null)).mockResolvedValue(reply);
    const { result } = setup();
    await act(async () => {
      await expect(result.current.send("um")).rejects.toBeInstanceOf(ApiError);
    });
    await act(async () => {
      await result.current.send("dois");
    });
    await act(async () => {
      await result.current.send("dois");
    });
    const ids = api.sendAssistantMessage.mock.calls.map((c) => c[0].clientMessageId);
    expect(new Set(ids).size).toBe(3);
  });

  it("envio duplo simultâneo faz uma só chamada", async () => {
    let resolve!: (v: unknown) => void;
    api.sendAssistantMessage.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = setup();
    let a!: Promise<unknown>;
    let b!: Promise<unknown>;
    act(() => {
      a = result.current.send("x");
      b = result.current.send("x");
    });
    expect(result.current.pending).toBe(true);
    await act(async () => {
      resolve(reply);
      await Promise.all([a, b]);
    });
    expect(api.sendAssistantMessage).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(false);
  });

  it("rejeita texto vazio ou acima de 1000 sem chamar a API", async () => {
    const { result } = setup();
    await act(async () => {
      await expect(result.current.send("   ")).rejects.toMatchObject({ code: "entrada_invalida" });
      await expect(result.current.send("a".repeat(1001))).rejects.toMatchObject({ code: "entrada_invalida" });
    });
    expect(api.sendAssistantMessage).not.toHaveBeenCalled();
    await act(async () => {
      api.sendAssistantMessage.mockResolvedValue(reply);
      await result.current.send("a".repeat(1000));
    });
    expect(api.sendAssistantMessage).toHaveBeenCalledTimes(1);
  });
});
