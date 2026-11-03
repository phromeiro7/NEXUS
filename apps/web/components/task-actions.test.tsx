import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { makeTask } from "@/test/factories";
import { TaskRowActions } from "./task-actions";

const api = { deleteTask: vi.fn(), updateTask: vi.fn(), listCases: vi.fn() };
vi.mock("@/components/auth-provider", () => ({ useApi: () => api }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TaskRowActions task={makeTask({ id: "t1", title: "Minuta" })} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  api.listCases.mockResolvedValue([]);
});

describe("TaskRowActions", () => {
  it("Editar e Excluir têm alvo de toque de 40 px (min-h-10)", () => {
    setup();
    expect(screen.getByRole("button", { name: "Editar Minuta" }).className).toContain("min-h-10");
    expect(screen.getByRole("button", { name: "Excluir Minuta" }).className).toContain("min-h-10");
  });

  it("excluir só chama a API após confirmar", async () => {
    api.deleteTask.mockResolvedValue(undefined);
    setup();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Excluir Minuta" }));
    const dialog = screen.getByRole("dialog", { name: "Excluir tarefa?" });
    expect(dialog).toBeInTheDocument();
    expect(api.deleteTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sim, excluir" }));
    await waitFor(() => expect(api.deleteTask).toHaveBeenCalledWith("t1"));
  });

  it("cancelar não chama a API e devolve o foco ao gatilho (mesmo sem ele ter foco ao clicar)", () => {
    setup();
    const trigger = screen.getByRole("button", { name: "Excluir Minuta" });
    // Safari/Firefox no macOS não focam o botão ao clicar: nenhum trigger.focus() aqui.
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.deleteTask).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it("Escape também devolve o foco ao gatilho", () => {
    setup();
    const trigger = screen.getByRole("button", { name: "Excluir Minuta" });
    fireEvent.click(trigger);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(trigger).toHaveFocus();
  });

  it("após excluir, o foco vai para um alvo estável do Painel", async () => {
    api.deleteTask.mockResolvedValue(undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <h1 data-after-delete-focus tabIndex={-1}>
          Painel
        </h1>
        <TaskRowActions task={makeTask({ id: "t1", title: "Minuta" })} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Excluir Minuta" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, excluir" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Painel" })).toHaveFocus());
  });

  it("Escape cancela", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Excluir Minuta" }));
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.deleteTask).not.toHaveBeenCalled();
  });

  it("falha na exclusão mostra a mensagem", async () => {
    api.deleteTask.mockRejectedValue(new ApiError(404, "nao_encontrado", null));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Excluir Minuta" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, excluir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não encontramos este item.");
  });

  it("Editar abre o formulário preenchido", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Editar Minuta" }));
    expect(screen.getByLabelText("Título")).toHaveValue("Minuta");
  });
});
