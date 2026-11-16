import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ListTasksQuery, TaskDto } from "@nexus/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { createFakeFinanceApi } from "@/test/fake-finance-api";
import { makeTask } from "@/test/factories";
import { TaskDetail } from "./task-detail";
import { TodayScreen } from "./today-screen";
import { ToastProvider } from "./toast";

const holder = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/mini" }));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ userId: "u1" }), useApi: () => holder.api }));
vi.mock("@/hooks/use-today", () => ({ useToday: () => "2026-11-04" }));

let tasks: TaskDto[];
const updateTask = vi.fn();
const settings = { timezone: "America/Sao_Paulo", earlyReminderMinutes: 15, briefingTime: "08:00", telegramLinked: true, channelPaused: false, uf: null };

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

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

const toastOf = async (text: string) => (await screen.findAllByRole("status")).find((n) => n.textContent?.includes(text))!;

beforeEach(() => {
  localStorage.clear();
  const fake = createFakeFinanceApi();
  tasks = [
    makeTask({ id: "t1", title: "Enviar proposta", dueDate: "2026-11-03" }),
    makeTask({ id: "t2", title: "Ligar para o contador", dueDate: "2026-11-04", dueTime: "14:00" }),
    makeTask({ id: "t3", title: "Contestação", type: "prazo", fatal: true, dueDate: "2026-11-04" }),
    makeTask({ id: "t4", title: "Já feita", dueDate: "2026-11-04", status: "concluida" }),
  ];
  updateTask.mockReset().mockImplementation(async (id: string, input: Partial<TaskDto>) => {
    const t = tasks.find((x) => x.id === id)!;
    Object.assign(t, input);
    return t;
  });
  holder.api = {
    ...fake.api,
    listTasks: vi.fn(async (q: ListTasksQuery) => listTasks(q)),
    getTask: vi.fn(async (id: string) => ({ ...tasks.find((x) => x.id === id)! })),
    updateTask,
    getSettings: vi.fn().mockResolvedValue(settings),
  };
});

describe("TodayScreen: adiar com um gesto", () => {
  it("o botão Amanhã adia, avisa com a data e Desfazer restaura data e hora", async () => {
    wrap(<TodayScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Adiar para amanhã: Ligar para o contador" }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("t2", { dueDate: "2026-11-05" }));
    const toast = await toastOf("Adiada");
    expect(toast).toHaveTextContent("Adiada para amanhã, 14h: Ligar para o contador.");
    await userEvent.click(within(toast).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(updateTask).toHaveBeenLastCalledWith("t2", { dueDate: "2026-11-04", dueTime: "14:00" }));
  });

  it("o botão tem texto visível e a tarefa atrasada vai para amanhã, não atual+1", async () => {
    wrap(<TodayScreen />);
    const btn = await screen.findByRole("button", { name: "Adiar para amanhã: Enviar proposta" });
    expect(btn).toHaveTextContent("Amanhã");
    await userEvent.click(btn);
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("t1", { dueDate: "2026-11-05" }));
  });

  it("prazo fatal diz a nova data com clareza", async () => {
    wrap(<TodayScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Adiar para amanhã: Contestação" }));
    expect(await toastOf("Prazo fatal")).toHaveTextContent("Prazo fatal movido para amanhã: Contestação.");
  });

  it("se a API recusa, volta como estava e avisa sem toast de sucesso", async () => {
    updateTask.mockRejectedValueOnce(new ApiError(500, "erro_interno", null));
    wrap(<TodayScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Adiar para amanhã: Ligar para o contador" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Adiada para/)).not.toBeInTheDocument();
    expect(tasks.find((t) => t.id === "t2")).toMatchObject({ dueDate: "2026-11-04" });
    expect(screen.getByRole("button", { name: "Adiar para amanhã: Ligar para o contador" })).toBeInTheDocument();
  });

  it("concluída não aparece na lista aberta, logo não há atalho para ela", async () => {
    wrap(<TodayScreen />);
    await screen.findByRole("button", { name: "Adiar para amanhã: Ligar para o contador" });
    expect(screen.queryByRole("button", { name: /Adiar para .*Já feita/ })).not.toBeInTheDocument();
  });
});

describe("TaskDetail: adiar", () => {
  it("Próxima segunda adia, avisa e Desfazer restaura", async () => {
    wrap(<TaskDetail id="t2" />);
    await userEvent.click(await screen.findByRole("button", { name: "Adiar" }));
    await userEvent.click(screen.getByRole("button", { name: "Próxima segunda" }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("t2", { dueDate: "2026-11-09", dueTime: "14:00" }));
    const toast = await toastOf("Adiada");
    expect(toast).toHaveTextContent("Adiada para segunda-feira, 09/11, 14h: Ligar para o contador.");
    await userEvent.click(within(toast).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(updateTask).toHaveBeenLastCalledWith("t2", { dueDate: "2026-11-04", dueTime: "14:00" }));
  });

  it("recusa da API mostra o erro e não avisa sucesso", async () => {
    updateTask.mockRejectedValueOnce(new ApiError(500, "erro_interno", null));
    wrap(<TaskDetail id="t2" />);
    await userEvent.click(await screen.findByRole("button", { name: "Adiar" }));
    await userEvent.click(screen.getByRole("button", { name: "Amanhã" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Adiada para/)).not.toBeInTheDocument();
  });

  it("tarefa concluída não oferece Adiar", async () => {
    wrap(<TaskDetail id="t4" />);
    expect(await screen.findByRole("button", { name: "Reabrir tarefa" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adiar" })).not.toBeInTheDocument();
  });
});
