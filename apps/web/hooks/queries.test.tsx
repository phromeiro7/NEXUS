import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { queryKeys, useCreateTask, useDeleteTask, useTasks, useUpdateTask } from "./queries";

const api = {
  listTasks: vi.fn(),
  getSettings: vi.fn(),
  getBriefing: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
};
vi.mock("@/components/auth-provider", () => ({ useApi: () => api }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, spy, wrapper };
}

describe("chaves de consulta", () => {
  it("são estáveis", () => {
    expect(queryKeys.tasks({ from: "2026-10-26" } as never)).toEqual(["tasks", { from: "2026-10-26" }]);
    expect(queryKeys.settings).toEqual(["settings"]);
    expect(queryKeys.briefing).toEqual(["briefing"]);
    expect(queryKeys.holidays).toEqual(["holidays"]);
    expect(queryKeys.cases).toEqual(["cases"]);
  });
});

describe("useTasks", () => {
  it("busca com a chave ['tasks', query]", async () => {
    api.listTasks.mockResolvedValue([]);
    const { client, wrapper } = setup();
    const query = { from: "2026-10-26", to: "2026-11-01" } as never;
    const { result } = renderHook(() => useTasks(query), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.listTasks).toHaveBeenCalledWith(query);
    expect(client.getQueryData(["tasks", query])).toEqual([]);
  });
});

describe("mutações", () => {
  function keysInvalidated(spy: ReturnType<typeof setup>["spy"]) {
    return spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
  }

  it("criar invalida tasks e briefing", async () => {
    api.createTask.mockResolvedValue({ id: "1" });
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useCreateTask(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ title: "x" } as never);
    });
    expect(keysInvalidated(spy)).toEqual(expect.arrayContaining([["tasks"], ["briefing"]]));
  });

  it("atualizar invalida tasks e briefing e repassa opções extras", async () => {
    api.updateTask.mockResolvedValue({ id: "1" });
    const { spy, wrapper } = setup();
    const onSettled = vi.fn();
    const { result } = renderHook(() => useUpdateTask({ onSettled }), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "1", input: { status: "done" } as never });
    });
    expect(api.updateTask).toHaveBeenCalledWith("1", { status: "done" });
    expect(keysInvalidated(spy)).toEqual(expect.arrayContaining([["tasks"], ["briefing"]]));
    expect(onSettled).toHaveBeenCalled();
  });

  it("remover invalida tasks e briefing", async () => {
    api.deleteTask.mockResolvedValue(undefined);
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useDeleteTask(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("1");
    });
    expect(api.deleteTask).toHaveBeenCalledWith("1");
    expect(keysInvalidated(spy)).toEqual(expect.arrayContaining([["tasks"], ["briefing"]]));
  });
});
