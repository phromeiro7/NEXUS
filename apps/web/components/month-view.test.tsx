import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskDto } from "@aj/shared";
import { makeTask } from "@/test/factories";
import { MonthView } from "./month-view";

const api = { listTasks: vi.fn(), getSettings: vi.fn(), getBriefing: vi.fn(), updateTask: vi.fn() };
vi.mock("@/components/auth-provider", () => ({ useApi: () => api }));

const nav = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("v=mes"),
  usePathname: () => "/",
  useRouter: () => nav,
}));

let data: TaskDto[];

function setup(props: { year?: number; month?: number }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MonthView {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  data = [];
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-02-10T15:00:00Z") });
  api.getSettings.mockResolvedValue({ timezone: "America/Sao_Paulo" });
  api.listTasks.mockImplementation(async () => data);
});

describe("MonthView", () => {
  it("fev/2026 tem 5 linhas e mostra '2 tarefas, 1 fatal' em 2026-02-10", async () => {
    data = [
      makeTask({ id: "a", dueDate: "2026-02-10" }),
      makeTask({ id: "b", dueDate: "2026-02-10", fatal: true, type: "prazo" }),
      makeTask({ id: "c", dueDate: "2026-02-11" }),
    ];
    setup({ year: 2026, month: 2 });
    const cell = await screen.findByRole("button", { name: /10 de fevereiro/ });
    expect(await within(cell).findByText("2 tarefas, 1 fatal")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(5 + 1); // 5 semanas + cabeçalho
    const c11 = screen.getByRole("button", { name: /11 de fevereiro/ });
    expect(within(c11).getByText("1 tarefa")).toBeInTheDocument();
    const c12 = screen.getByRole("button", { name: /12 de fevereiro/ });
    expect(within(c12).queryByText(/tarefa/)).toBeNull();
  });

  it("consulta o intervalo do mês e só status abertos", async () => {
    setup({ year: 2026, month: 2 });
    await screen.findByRole("button", { name: /10 de fevereiro/ });
    expect(api.listTasks).toHaveBeenCalledWith({
      from: "2026-02-01",
      to: "2026-02-28",
      status: ["pendente", "em_andamento"],
    });
  });

  it("clicar no dia abre a visão Dia naquela data", async () => {
    setup({ year: 2026, month: 2 });
    fireEvent.click(await screen.findByRole("button", { name: /11 de fevereiro/ }));
    expect(nav.push).toHaveBeenCalledWith("/?v=dia&d=2026-02-11");
  });

  it("marca hoje com texto e aria-current; dias fora do mês ficam identificados", async () => {
    setup({ year: 2026, month: 2 });
    const today = await screen.findByRole("button", { name: /10 de fevereiro/ });
    expect(today).toHaveAttribute("aria-current", "date");
    expect(within(today).getByText("(hoje)")).toBeInTheDocument();
    // 2026-02-01 é domingo: a grade começa em 26/01
    const out = screen.getByRole("button", { name: /26 de janeiro/ });
    expect(out).toHaveAttribute("data-outside", "true");
    expect(screen.getByRole("button", { name: /12 de fevereiro/ })).not.toHaveAttribute("data-outside");
  });

  it("setas mudam o mês via ?d= (virada de ano) e Hoje remove ?d=", async () => {
    setup({ year: 2026, month: 12 });
    await screen.findByRole("button", { name: /10 de dezembro/ });
    fireEvent.click(screen.getByRole("button", { name: "Mês seguinte" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/?v=mes&d=2027-01-01");
    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/?v=mes&d=2026-11-01");
    fireEvent.click(screen.getByRole("button", { name: "Hoje" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/?v=mes");
  });

  it("sem ano/mês usa o mês de hoje", async () => {
    setup({});
    await screen.findByRole("button", { name: /10 de fevereiro/ });
    expect(api.listTasks).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-02-01", to: "2026-02-28" }));
  });
});
