import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/mini/toast";
import { ApiError } from "@/lib/api";
import { createFakeFinanceApi } from "@/test/fake-finance-api";
import { makeTask } from "@/test/factories";
import { CaptureBar } from "./capture-bar";
import { ShortcutsProvider } from "./shortcuts";

const holder = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ userId: "u1" }),
  useApi: () => holder.api,
}));

let fake: ReturnType<typeof createFakeFinanceApi>;
const interpretCapture = vi.fn();
const createTask = vi.fn();
const deleteTask = vi.fn();

const TODAY = "2026-11-04";
const gasto = { kind: "gasto", description: "roupa", amountCents: 10000, category: "Roupas", date: TODAY, time: null, status: "paga" };
const tarefa = { kind: "tarefa", title: "Reunião com a equipe", date: TODAY, time: "14:00", vagueTime: false };
const conta = { kind: "conta", description: "luz", amountCents: 18740, category: "Moradia", date: null, time: null, status: "a_pagar" };

function renderBar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ShortcutsProvider>
          <CaptureBar />
        </ShortcutsProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function send(text: string) {
  await userEvent.type(screen.getByLabelText("Nova tarefa ou lançamento"), `${text}{Enter}`);
}

beforeEach(() => {
  localStorage.clear();
  fake = createFakeFinanceApi();
  interpretCapture.mockReset();
  createTask.mockReset().mockImplementation(async (input) => makeTask({ id: "novo", title: input.title }));
  deleteTask.mockReset().mockResolvedValue(undefined);
  holder.api = { ...fake.api, interpretCapture, createTask, deleteTask, listTasks: vi.fn().mockResolvedValue([]) };
});

describe("CaptureBar", () => {
  it("mostra o que entendeu e não grava nada antes de Confirmar", async () => {
    interpretCapture.mockResolvedValue({ today: TODAY, proposal: gasto });
    renderBar();
    await send("gastei 100 em roupa");
    expect(await screen.findByText(/R\$ 100,00 em Roupas, hoje/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeEnabled();
    expect(interpretCapture).toHaveBeenCalledWith({ text: "gastei 100 em roupa" });
    expect(fake.api.createFinanceEntry).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("Confirmar grava o gasto pela API, limpa o campo e avisa com Desfazer", async () => {
    interpretCapture.mockResolvedValue({ today: TODAY, proposal: gasto });
    renderBar();
    await send("gastei 100 em roupa");
    await userEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(fake.rows.size).toBe(1));
    expect([...fake.rows.values()][0]).toMatchObject({ kind: "gasto", description: "roupa", amountCents: 10000, category: "Roupas", dueDate: TODAY, status: "paga" });
    expect(screen.getByLabelText("Nova tarefa ou lançamento")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
    const toast = screen.getAllByRole("status").find((n) => n.textContent?.includes("Anotado"))!;
    expect(toast).toHaveTextContent("Anotado: R$ 100,00 em Roupas, hoje.");
    await userEvent.click(within(toast).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(fake.rows.size).toBe(0));
  });

  it("Confirmar cria a tarefa com dia e horário, sem assumir nada", async () => {
    interpretCapture.mockResolvedValue({ today: TODAY, proposal: tarefa });
    renderBar();
    await send("Reunião com a equipe sexta 9h30");
    expect(await screen.findByText(/Reunião com a equipe, hoje às 14h/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(createTask.mock.calls[0]![0]).toEqual({ title: "Reunião com a equipe", type: "tarefa", caseId: null, dueDate: TODAY, dueTime: "14:00", fatal: false });
    const toast = screen.getAllByRole("status").find((n) => n.textContent?.includes("Anotado"))!;
    await userEvent.click(within(toast).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("novo"));
  });

  it("Descartar fecha a proposta sem gravar", async () => {
    interpretCapture.mockResolvedValue({ today: TODAY, proposal: gasto });
    renderBar();
    await send("gastei 100 em roupa");
    await userEvent.click(await screen.findByRole("button", { name: "Descartar" }));
    expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
    expect(fake.api.createFinanceEntry).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nova tarefa ou lançamento")).toHaveValue("");
  });

  it("quando as regras não entendem, mostra exemplos e não grava", async () => {
    interpretCapture.mockResolvedValue({ today: TODAY, proposal: null });
    renderBar();
    await send("quanto gastei?");
    expect(await screen.findByText("Não entendi.")).toBeInTheDocument();
    expect(screen.getByText(/Tente: gastei 45 no mercado/)).toBeInTheDocument();
    expect(fake.api.createFinanceEntry).not.toHaveBeenCalled();
  });

  it("conta sem vencimento pergunta o dia: só confirma depois de escolher em Editar", async () => {
    interpretCapture.mockResolvedValue({ today: TODAY, proposal: conta });
    renderBar();
    await send("luz 187,40");
    expect(await screen.findByText("Qual o vencimento?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Editar" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Vencimento" })).getByRole("button", { name: "Amanhã" }));
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(fake.rows.size).toBe(1));
    expect([...fake.rows.values()][0]).toMatchObject({ kind: "conta", status: "a_pagar", dueDate: "2026-11-05", amountCents: 18740 });
  });

  it("Editar troca a categoria e o dia antes de gravar", async () => {
    interpretCapture.mockResolvedValue({ today: TODAY, proposal: gasto });
    renderBar();
    await send("gastei 100 em roupa");
    await userEvent.click(await screen.findByRole("button", { name: "Editar" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Categoria" })).getByRole("button", { name: "Lazer" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Dia" })).getByRole("button", { name: "Ontem" }));
    expect(screen.getByText(/R\$ 100,00 em Lazer \(roupa\), ontem/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(fake.rows.size).toBe(1));
    expect([...fake.rows.values()][0]).toMatchObject({ category: "Lazer", dueDate: "2026-11-03" });
  });

  it("um exemplo clicado já é interpretado", async () => {
    interpretCapture.mockResolvedValue({ today: TODAY, proposal: tarefa });
    renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Reunião com a equipe sexta 9h30" }));
    expect(await screen.findByText(/Reunião com a equipe, hoje às 14h/)).toBeInTheDocument();
    expect(interpretCapture).toHaveBeenCalledWith({ text: "Reunião com a equipe sexta 9h30" });
  });

  it("falha da API aparece como aviso e nada é gravado", async () => {
    interpretCapture.mockRejectedValue(new ApiError(503, "indisponivel", null));
    renderBar();
    await send("gastei 100");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(fake.api.createFinanceEntry).not.toHaveBeenCalled();
  });

  it("não envia frase vazia: Adicionar sem texto só devolve o foco ao campo", async () => {
    renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(screen.getByLabelText("Nova tarefa ou lançamento")).toHaveFocus();
    await userEvent.type(screen.getByLabelText("Nova tarefa ou lançamento"), "   {Enter}");
    expect(interpretCapture).not.toHaveBeenCalled();
  });

  it("o botão Adicionar envia a frase e o foco vai para Confirmar na proposta", async () => {
    interpretCapture.mockResolvedValue({ today: TODAY, proposal: gasto });
    renderBar();
    await userEvent.type(screen.getByLabelText("Nova tarefa ou lançamento"), "Gastei 100 em roupa");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    const confirm = await screen.findByRole("button", { name: "Confirmar" });
    await waitFor(() => expect(confirm).toHaveFocus());
    expect(screen.getByRole("group", { name: "Proposta" })).toBeInTheDocument();
  });

  it("os exemplos são genéricos", () => {
    renderBar();
    expect(screen.getByRole("button", { name: "Gastei 45 no mercado" })).toBeInTheDocument();
    expect(screen.queryByText(/vidinha|roupa/i)).not.toBeInTheDocument();
  });
});
