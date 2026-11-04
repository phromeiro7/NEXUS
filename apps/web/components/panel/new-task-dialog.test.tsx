import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/mini/toast";
import { ApiError } from "@/lib/api";
import { makeTask } from "@/test/factories";
import { NewTaskDialog } from "./new-task-dialog";

const holder = vi.hoisted(() => ({ api: { createTask: vi.fn(), deleteTask: vi.fn() } }));
vi.mock("@/components/auth-provider", () => ({ useApi: () => holder.api }));

const onClose = vi.fn();

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <NewTaskDialog onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  onClose.mockReset();
  holder.api.createTask.mockReset().mockImplementation(async (input) => makeTask({ id: "novo", title: input.title }));
  holder.api.deleteTask.mockReset().mockResolvedValue(undefined);
});

describe("NewTaskDialog", () => {
  it("o foco começa no título", () => {
    renderDialog();
    expect(screen.getByLabelText("O que precisa ser feito")).toHaveFocus();
  });

  it("cria a tarefa com dia e horário, fecha e avisa com Desfazer", async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText("O que precisa ser feito"), "Ligar para o contador");
    await userEvent.type(screen.getByLabelText("Dia"), "2026-11-05");
    await userEvent.type(screen.getByLabelText("Horário"), "14:00");
    await userEvent.click(screen.getByRole("button", { name: "Anotar tarefa" }));
    await waitFor(() => expect(holder.api.createTask).toHaveBeenCalledTimes(1));
    expect(holder.api.createTask.mock.calls[0]![0]).toMatchObject({ title: "Ligar para o contador", type: "tarefa", dueDate: "2026-11-05", dueTime: "14:00" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const toast = (await screen.findAllByRole("status")).find((n) => n.textContent?.includes("Tarefa anotada"))!;
    await userEvent.click(within(toast).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(holder.api.deleteTask).toHaveBeenCalledWith("novo"));
  });

  it("sem dia, a tarefa fica sem data (nada é assumido)", async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText("O que precisa ser feito"), "Comprar ração");
    await userEvent.click(screen.getByRole("button", { name: "Anotar tarefa" }));
    await waitFor(() => expect(holder.api.createTask).toHaveBeenCalled());
    expect(holder.api.createTask.mock.calls[0]![0]).toMatchObject({ dueDate: null, dueTime: null });
  });

  it("exige título e dia para usar horário, sem chamar a API", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Anotar tarefa" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Escreva o que precisa ser feito/);
    await userEvent.type(screen.getByLabelText("O que precisa ser feito"), "Algo");
    await userEvent.type(screen.getByLabelText("Horário"), "10:00");
    await userEvent.click(screen.getByRole("button", { name: "Anotar tarefa" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Escolha o dia para usar um horário.");
    expect(holder.api.createTask).not.toHaveBeenCalled();
  });

  it("falha da API mantém o diálogo aberto com o erro", async () => {
    holder.api.createTask.mockRejectedValue(new ApiError(503, "indisponivel", null));
    renderDialog();
    await userEvent.type(screen.getByLabelText("O que precisa ser feito"), "Algo");
    await userEvent.click(screen.getByRole("button", { name: "Anotar tarefa" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cancelar fecha sem criar", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalled();
    expect(holder.api.createTask).not.toHaveBeenCalled();
  });
});
