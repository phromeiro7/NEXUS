import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListTasksQuery, TaskDto } from "@aj/shared";
import { ApiError } from "@/lib/api";
import { messageFor } from "@/lib/messages";
import { makeTask } from "@/test/factories";
import { DayView } from "./day-view";

const api = {
  listTasks: vi.fn(),
  getSettings: vi.fn(),
  getBriefing: vi.fn(),
  updateTask: vi.fn(),
};
vi.mock("@/components/auth-provider", () => ({ useApi: () => api }));

const TODAY = "2026-10-27";
let data: { overdue: TaskDto[]; today: TaskDto[]; undated: TaskDto[] };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DayView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  data = { overdue: [], today: [], undated: [] };
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-27T15:00:00Z") });
  api.getSettings.mockResolvedValue({ timezone: "America/Sao_Paulo" });
  api.getBriefing.mockResolvedValue({ today: TODAY, overdue: [], fatalToday: [], hearingsToday: [], nextTwoDays: [] });
  api.listTasks.mockImplementation(async (q: ListTasksQuery) => {
    if (q.withoutDate) return data.undated;
    if (q.from) return data.today;
    return data.overdue;
  });
  document.title = "";
});

describe("DayView", () => {
  it("mostra seções na ordem e omite as vazias", async () => {
    data.overdue = [makeTask({ id: "a", title: "Velha", dueDate: "2026-10-20" })];
    data.today = [
      makeTask({ id: "b", title: "Fatal hoje", fatal: true, type: "prazo" }),
      makeTask({ id: "c", title: "Com hora", dueTime: "09:00" }),
      makeTask({ id: "d", title: "Sem hora" }),
    ];
    data.undated = [makeTask({ id: "e", title: "Solta", dueDate: null })];
    setup();
    await screen.findByText("Velha");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Atrasadas", "Fatais de hoje", "Com horário", "Demais de hoje", "Sem data"]);
  });

  it("seção vazia não aparece", async () => {
    data.today = [makeTask({ id: "d", title: "Sem hora" })];
    setup();
    await screen.findByText("Sem hora");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Demais de hoje"]);
  });

  it("o título da aba mostra a contagem de pendências", async () => {
    data.overdue = [makeTask({ id: "a", dueDate: "2026-10-20" })];
    data.today = [makeTask({ id: "d" })];
    setup();
    await waitFor(() => expect(document.title).toBe("(2) Assistente Jurídico"));
  });

  it("Concluir tira a linha de Atrasadas antes da resposta da API", async () => {
    data.overdue = [makeTask({ id: "a", title: "Velha", dueDate: "2026-10-20" })];
    api.updateTask.mockReturnValue(new Promise(() => {}));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Concluir Velha" }));
    await waitFor(() => expect(screen.queryByText("Velha")).toBeNull());
    expect(api.updateTask).toHaveBeenCalledWith("a", { status: "concluida" });
    expect(screen.queryByRole("heading", { name: "Atrasadas" })).toBeNull();
  });

  it("409 restaura a linha e mostra a mensagem", async () => {
    data.overdue = [makeTask({ id: "a", title: "Velha", dueDate: "2026-10-20" })];
    const error = new ApiError(409, "transicao_invalida", null);
    api.updateTask.mockRejectedValue(error);
    // Depois da carga inicial, qualquer refetch nunca resolve: só o rollback do onError
    // pode devolver a linha.
    const initial = api.listTasks.getMockImplementation()!;
    let loads = 0;
    api.listTasks.mockImplementation((q: ListTasksQuery) =>
      ++loads <= 3 ? initial(q) : new Promise(() => {}),
    );
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Concluir Velha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(messageFor(error));
    const section = (await screen.findByRole("heading", { name: "Atrasadas" })).closest("section")!;
    expect(within(section).getByText("Velha")).toBeInTheDocument();
  });

  it("dois cliques rápidos geram uma única chamada", async () => {
    data.today = [makeTask({ id: "a", title: "Hoje" })];
    api.updateTask.mockReturnValue(new Promise(() => {}));
    setup();
    const button = await screen.findByRole("button", { name: "Concluir Hoje" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(api.updateTask).toHaveBeenCalled());
    expect(api.updateTask).toHaveBeenCalledTimes(1);
  });
});
