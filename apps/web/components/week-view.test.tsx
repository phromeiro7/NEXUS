import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListTasksQuery, TaskDto } from "@aj/shared";
import { makeTask } from "@/test/factories";
import { WeekView } from "./week-view";

const api = { listTasks: vi.fn(), getSettings: vi.fn(), getBriefing: vi.fn(), updateTask: vi.fn() };
vi.mock("@/components/auth-provider", () => ({ useApi: () => api }));

const nav = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("v=semana"),
  usePathname: () => "/",
  useRouter: () => nav,
}));

let data: TaskDto[];

function setup(anchor: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WeekView anchor={anchor as never} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  data = [];
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2027-01-01T15:00:00Z") });
  api.getSettings.mockResolvedValue({ timezone: "America/Sao_Paulo" });
  api.listTasks.mockImplementation(async () => data);
});

describe("WeekView layout", () => {
  it("a grade só vira 7 colunas em telas xl (com a lateral, 1024 px não cabe)", async () => {
    setup("2026-12-28");
    const [first] = await screen.findAllByRole("region");
    const grid = first!.parentElement!;
    expect(grid.className).toContain("xl:grid-cols-7");
    expect(grid.className).not.toMatch(/(^|\s)lg:grid-cols-7/);
  });
});

describe("WeekView", () => {
  it("semana de 2026-12-28: 7 colunas até 2027-01-03, tarefa de 2027-01-01 na coluna certa", async () => {
    data = [makeTask({ id: "a", title: "Ano novo", dueDate: "2027-01-01" })];
    setup("2026-12-28");
    const cols = await screen.findAllByRole("region");
    expect(cols).toHaveLength(7);
    expect(cols[0]).toHaveAccessibleName(/Segunda.*28\/12/);
    expect(cols[6]).toHaveAccessibleName(/Domingo.*03\/01/);
    expect(within(cols[4]!).getByText("Ano novo")).toBeInTheDocument();
    expect(within(cols[0]!).queryByText("Ano novo")).toBeNull();
  });

  it("consulta o período inteiro e só status abertos", async () => {
    setup("2026-12-30");
    await screen.findAllByRole("region");
    expect(api.listTasks).toHaveBeenCalledWith({
      from: "2026-12-28",
      to: "2027-01-03",
      status: ["pendente", "em_andamento"],
    } satisfies ListTasksQuery);
  });

  it("marca a coluna de hoje com texto e aria-current", async () => {
    setup("2026-12-28");
    const cols = await screen.findAllByRole("region");
    const today = cols[4]!; // 2027-01-01 no fuso de São Paulo
    expect(today).toHaveAttribute("aria-current", "date");
    expect(within(today).getByText("(hoje)")).toBeInTheDocument();
    expect(cols[3]).not.toHaveAttribute("aria-current");
  });

  it("fatal aparece com o texto Fatal e a coluna segue a ordem de groupWeek", async () => {
    data = [
      makeTask({ id: "a", title: "Sem hora", dueDate: "2026-12-29" }),
      makeTask({ id: "b", title: "Com hora", dueDate: "2026-12-29", dueTime: "09:00", fatal: true, type: "prazo" }),
    ];
    setup("2026-12-28");
    const col = (await screen.findAllByRole("region"))[1]!;
    expect(within(col).getByText("Fatal")).toBeInTheDocument();
    const items = within(col).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Com hora");
    expect(items[1]).toHaveTextContent("Sem hora");
  });

  it("setas mudam ?d= em 7 dias; Hoje remove ?d=", async () => {
    setup("2026-12-28");
    await screen.findAllByRole("region");
    fireEvent.click(screen.getByRole("button", { name: "Semana seguinte" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/?v=semana&d=2027-01-04");
    fireEvent.click(screen.getByRole("button", { name: "Semana anterior" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/?v=semana&d=2026-12-21");
    fireEvent.click(screen.getByRole("button", { name: "Hoje" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/?v=semana");
  });

  it("sem âncora usa hoje no fuso das configurações", async () => {
    setup(null);
    await screen.findAllByRole("region");
    expect(api.listTasks).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-12-28", to: "2027-01-03" }));
  });
});
