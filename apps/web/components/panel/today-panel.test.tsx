import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ListTasksQuery, TaskDto } from "@aj/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/mini/toast";
import { createFakeFinanceApi } from "@/test/fake-finance-api";
import { makeTask } from "@/test/factories";
import { ShortcutsProvider } from "./shortcuts";
import { daySentence, TodayPanel } from "./today-panel";

const holder = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ userId: "u1" }),
  useApi: () => holder.api,
}));
vi.mock("@/hooks/use-today", () => ({ useToday: () => "2026-11-04" }));

let fake: ReturnType<typeof createFakeFinanceApi>;
let tasks: TaskDto[];
const updateTask = vi.fn();
const settings = { timezone: "America/Sao_Paulo", earlyReminderMinutes: 15, briefingTime: "08:00", telegramLinked: true, channelPaused: false, uf: null };

/** Responde ao listTasks como a API: por status e por intervalo de datas. */
function listTasks(q: ListTasksQuery): TaskDto[] {
  const statuses = Array.isArray(q.status) ? q.status : q.status ? [q.status] : [];
  return tasks.filter((t) => {
    if (statuses.length > 0 && !statuses.includes(t.status)) return false;
    if (q.withoutDate) return t.dueDate === null;
    if (t.dueDate === null) return false;
    if (q.from && t.dueDate < q.from) return false;
    if (q.to && t.dueDate > q.to) return false;
    return true;
  });
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ShortcutsProvider>
          <TodayPanel />
        </ShortcutsProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  fake = createFakeFinanceApi();
  tasks = [
    makeTask({ id: "t1", title: "Enviar proposta ao Marcos", dueDate: "2026-11-03" }),
    makeTask({ id: "t2", title: "Ligar para o contador", dueDate: "2026-11-04", dueTime: "14:00" }),
    makeTask({ id: "t3", title: "Buscar encomenda", dueDate: "2026-11-04", dueTime: "16:30" }),
    makeTask({ id: "t4", title: "Pensar na viagem", dueDate: null }),
    makeTask({ id: "t5", title: "Renovar o seguro", dueDate: "2026-11-06" }),
    makeTask({ id: "t6", title: "Pagar IPTU", dueDate: "2026-11-02", status: "concluida", completedAt: "2026-11-04T13:12:00.000Z" }),
    makeTask({ id: "t7", title: "Marcar dentista", dueDate: "2026-11-02", status: "concluida", completedAt: "2026-11-03T18:40:00.000Z" }),
  ];
  updateTask.mockReset().mockImplementation(async (id: string, input: { status?: TaskDto["status"] }) => {
    const t = tasks.find((x) => x.id === id)!;
    Object.assign(t, input);
    return t;
  });
  fake.seed({ kind: "conta", description: "Internet", amountCents: 11990, status: "a_pagar", dueDate: "2026-11-04", reminderTime: "09:00" });
  fake.seed({ kind: "conta", description: "Aluguel", amountCents: 120000, status: "a_pagar", dueDate: "2026-11-05", reminderTime: "09:00" });
  fake.seed({ kind: "entrada", description: "Salário", amountCents: 400000, dueDate: "2026-11-01" });
  fake.seed({ kind: "gasto", description: "Mercado", amountCents: 8640, dueDate: "2026-11-04" });
  holder.api = {
    ...fake.api,
    listTasks: vi.fn(async (q: ListTasksQuery) => listTasks(q)),
    updateTask,
    getSettings: vi.fn().mockResolvedValue(settings),
  };
});

describe("daySentence", () => {
  it("concorda em número e some com a parte vazia", () => {
    expect(daySentence(2, 2)).toBe("2 tarefas e 2 contas para hoje.");
    expect(daySentence(1, 1)).toBe("1 tarefa e 1 conta para hoje.");
    expect(daySentence(3, 0)).toBe("3 tarefas para hoje.");
    expect(daySentence(0, 2)).toBe("2 contas para hoje.");
    expect(daySentence(0, 0)).toBe("Hoje está em dia.");
  });
});

describe("TodayPanel", () => {
  it("mostra o dia, a frase, e as tarefas em Já passaram, Hoje, Sem data e Próximos dias", async () => {
    renderPanel();
    expect(await screen.findByRole("heading", { level: 1, name: /4 de novembro/ })).toBeInTheDocument();
    expect(await screen.findByText("3 tarefas e 1 conta para hoje.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Já passaram" })).toBeInTheDocument();
    expect(screen.getByText("Atrasada desde ontem")).toBeInTheDocument();
    expect(screen.getByText("Ligar para o contador")).toBeInTheDocument();
    expect(screen.getByText("14h")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sem data" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Próximos dias" })).toBeInTheDocument();
    expect(screen.getByText("Renovar o seguro")).toBeInTheDocument();
  });

  it("a barra de captura aparece em Hoje", async () => {
    renderPanel();
    expect(await screen.findByLabelText("Anotar tarefa, gasto ou conta")).toBeInTheDocument();
  });

  it("concluir marca a tarefa na API e avisa com Desfazer", async () => {
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Concluir: Ligar para o contador" }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("t2", { status: "concluida" }));
    const toast = (await screen.findAllByRole("status")).find((n) => n.textContent?.includes("Tarefa concluída"))!;
    expect(toast).toHaveTextContent("Tarefa concluída: Ligar para o contador.");
    await userEvent.click(within(toast).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("t2", { status: "pendente" }));
  });

  it("Contas a pagar mostra as vencidas e as do mês, com Paguei e Desfazer", async () => {
    renderPanel();
    const section = (await screen.findByRole("heading", { name: "Contas a pagar" })).closest("section")!;
    expect(await within(section).findByText("Internet")).toBeInTheDocument();
    expect(within(section).getByText(/Vence hoje · lembrete às 9h/)).toBeInTheDocument();
    expect(within(section).getByText("Aluguel")).toBeInTheDocument();
    expect(within(section).getByText("R$ 1.200,00")).toBeInTheDocument();
    await userEvent.click(within(section).getByRole("button", { name: "Paguei: Internet" }));
    await waitFor(() => expect(fake.api.updateFinanceEntry).toHaveBeenCalledWith(expect.any(String), { status: "paga" }));
    const toast = (await screen.findAllByRole("status")).find((n) => n.textContent?.includes("Conta paga"))!;
    await userEvent.click(within(toast).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(fake.api.updateFinanceEntry).toHaveBeenLastCalledWith(expect.any(String), { status: "a_pagar" }));
  });

  it("a frase do mês só aparece com lançamentos e leva às Finanças", async () => {
    renderPanel();
    const section = (await screen.findByRole("heading", { name: "Contas a pagar" })).closest("section")!;
    // entrou 4.000 − saiu 86,40 − a pagar 1.319,90 = 2.593,70
    expect(await within(section).findByText(/Novembro: sobram R\$ 2\.593,70 depois das contas/)).toBeInTheDocument();
    expect(within(section).getByText(/Entrou R\$ 4\.000 · Saiu R\$ 86,40 · Falta pagar R\$ 1\.319,90/)).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "Ver finanças" })).toHaveAttribute("href", "/financas");
  });

  it("sem lançamentos não há frase do mês nem link", async () => {
    fake.rows.clear();
    renderPanel();
    const section = (await screen.findByRole("heading", { name: "Contas a pagar" })).closest("section")!;
    expect(await within(section).findByText("Nenhuma conta em aberto neste mês.")).toBeInTheDocument();
    expect(within(section).queryByRole("link", { name: "Ver finanças" })).not.toBeInTheDocument();
  });

  it("Ver concluídas (N) abre as tarefas por dia e Reabrir volta a tarefa para a lista", async () => {
    renderPanel();
    const button = await screen.findByRole("button", { name: "Ver concluídas (2)" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(screen.getByRole("button", { name: "Esconder concluídas" })).toHaveAttribute("aria-expanded", "true");
    const hoje = screen.getByRole("region", { name: "Hoje" });
    expect(within(hoje).getByText("Pagar IPTU")).toBeInTheDocument();
    expect(within(hoje).getByText("Concluída às 10h12")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Ontem" })).getByText("Marcar dentista")).toBeInTheDocument();
    await userEvent.click(within(hoje).getByRole("button", { name: "Reabrir: Pagar IPTU" }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("t6", { status: "pendente" }));
  });

  it("clicar na tarefa abre o diálogo com Concluir, Adiar, Editar e Cancelar", async () => {
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Abrir: Buscar encomenda" }));
    const dialog = screen.getByRole("dialog", { name: "Buscar encomenda" });
    expect(within(dialog).getByText("Hoje, 16h30")).toBeInTheDocument();
    expect(within(dialog).getByText("Agendado para 16h30")).toBeInTheDocument();
    for (const name of ["Concluir", "Adiar", "Editar", "Cancelar tarefa"]) expect(within(dialog).getByRole("button", { name })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Adiar" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Amanhã" }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("t3", { dueDate: "2026-11-05", dueTime: "16:30" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cancelar pede confirmação e Excluir de vez apaga", async () => {
    const deleteTask = vi.fn().mockResolvedValue(undefined);
    (holder.api as Record<string, unknown>).deleteTask = deleteTask;
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Abrir: Buscar encomenda" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar tarefa" }));
    expect(within(dialog).getByRole("group", { name: "Confirmar cancelamento" })).toBeInTheDocument();
    expect(updateTask).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Excluir de vez" }));
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("t3"));
  });

  it("editar exige o dia para usar um horário", async () => {
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Abrir: Pensar na viagem" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Editar" }));
    await userEvent.type(within(dialog).getByLabelText("Horário"), "10:00");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Escolha o dia para usar um horário.");
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("sem nada para hoje, diz que está em dia", async () => {
    tasks = [];
    fake.rows.clear();
    renderPanel();
    expect(await screen.findByText("Hoje está em dia.", { selector: "p.pn-lead" })).toBeInTheDocument();
    expect(screen.getByText(/Hoje está em dia\. Use a barra de cima/)).toBeInTheDocument();
  });

  it("falha ao carregar as tarefas avisa sem esconder o resto", async () => {
    (holder.api as Record<string, unknown>).listTasks = vi.fn().mockRejectedValue(new Error("rede"));
    renderPanel();
    expect(await screen.findByText(/Não foi possível carregar suas tarefas/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Contas a pagar" })).toBeInTheDocument();
  });
});
