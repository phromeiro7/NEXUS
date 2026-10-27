import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListTasksQuery, TaskDto } from "@aj/shared";
import { ApiError } from "@/lib/api";
import { messageFor } from "@/lib/messages";
import { makeTask } from "@/test/factories";
import { HistoryView } from "./history-view";

const api = {
  listTasks: vi.fn(),
  getSettings: vi.fn(),
  getBriefing: vi.fn(),
  updateTask: vi.fn(),
};
vi.mock("@/components/auth-provider", () => ({ useApi: () => api }));

let data: TaskDto[];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HistoryView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  data = [];
  api.getSettings.mockResolvedValue({ timezone: "America/Sao_Paulo" });
  api.listTasks.mockImplementation(async (q: ListTasksQuery) =>
    data.filter((t) => (q.status ?? []).includes(t.status)),
  );
});

describe("HistoryView", () => {
  it("agrupa pelo dia da conclusão no fuso do usuário, mais recente primeiro", async () => {
    data = [
      // 02:30Z em São Paulo (UTC-3) ainda é 26/10; sem o fuso cairia no dia 27.
      makeTask({ id: "a", title: "Madrugada", status: "concluida", completedAt: "2026-10-27T02:30:00Z" }),
      makeTask({ id: "b", title: "Tarde", status: "concluida", completedAt: "2026-10-26T18:00:00Z" }),
      makeTask({ id: "c", title: "Antiga", status: "concluida", completedAt: "2026-10-20T15:00:00Z" }),
    ];
    setup();
    await screen.findByText("Madrugada");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent ?? "");
    expect(headings).toHaveLength(2);
    expect(headings[0]).toMatch(/26/);
    expect(headings[1]).toMatch(/20/);
    const first = screen.getAllByRole("heading", { level: 2 })[0]!.closest("section")!;
    expect(within(first).getByText("Madrugada")).toBeInTheDocument();
    expect(within(first).getByText("Tarde")).toBeInTheDocument();
    // Horário no fuso do usuário (23:30 do dia 26).
    expect(within(first).getByText("23:30")).toBeInTheDocument();
  });

  it("canceladas só aparecem com o filtro ligado e a consulta muda", async () => {
    data = [
      makeTask({ id: "a", title: "Feita", status: "concluida", completedAt: "2026-10-26T15:00:00Z" }),
      makeTask({ id: "b", title: "Desistida", status: "cancelada", completedAt: "2026-10-26T16:00:00Z" }),
    ];
    setup();
    await screen.findByText("Feita");
    expect(screen.queryByText("Desistida")).toBeNull();
    expect(api.listTasks).toHaveBeenCalledWith({ status: ["concluida"] });
    fireEvent.click(screen.getByRole("checkbox", { name: "Incluir canceladas" }));
    await screen.findByText("Desistida");
    expect(api.listTasks).toHaveBeenCalledWith({ status: ["concluida", "cancelada"] });
  });

  it("Reabrir envia pendente e remove o item antes da resposta da API", async () => {
    data = [makeTask({ id: "a", title: "Feita", status: "concluida", completedAt: "2026-10-26T15:00:00Z" })];
    api.updateTask.mockReturnValue(new Promise(() => {}));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Reabrir Feita" }));
    await waitFor(() => expect(screen.queryByText("Feita")).toBeNull());
    expect(api.updateTask).toHaveBeenCalledWith("a", { status: "pendente" });
  });

  it("erro restaura o item e mostra a mensagem", async () => {
    data = [makeTask({ id: "a", title: "Feita", status: "concluida", completedAt: "2026-10-26T15:00:00Z" })];
    const error = new ApiError(409, "transicao_invalida", null);
    api.updateTask.mockRejectedValue(error);
    const initial = api.listTasks.getMockImplementation()!;
    let loads = 0;
    api.listTasks.mockImplementation((q: ListTasksQuery) => (++loads <= 1 ? initial(q) : new Promise(() => {})));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Reabrir Feita" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(messageFor(error));
    expect(await screen.findByText("Feita")).toBeInTheDocument();
  });

  it("estado vazio mostra mensagem amigável", async () => {
    setup();
    expect(await screen.findByText("Nenhuma tarefa concluída ainda.")).toBeInTheDocument();
  });

  it("espera as configurações antes de agrupar", async () => {
    api.getSettings.mockReturnValue(new Promise(() => {}));
    setup();
    expect(await screen.findByRole("status")).toHaveTextContent("Carregando");
    expect(screen.queryByText("Nenhuma tarefa concluída ainda.")).toBeNull();
  });

  it("dois cliques rápidos em Reabrir geram uma única chamada", async () => {
    data = [makeTask({ id: "a", title: "Feita", status: "concluida", completedAt: "2026-10-26T15:00:00Z" })];
    api.updateTask.mockReturnValue(new Promise(() => {}));
    setup();
    const button = await screen.findByRole("button", { name: "Reabrir Feita" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(api.updateTask).toHaveBeenCalled());
    expect(api.updateTask).toHaveBeenCalledTimes(1);
  });
});
