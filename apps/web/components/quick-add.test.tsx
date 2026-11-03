import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { makeTask } from "@/test/factories";
import { QuickAdd } from "./quick-add";

const api = { createTask: vi.fn() };
vi.mock("@/components/auth-provider", () => ({ useApi: () => api }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <QuickAdd />
    </QueryClientProvider>,
  );
  return screen.getByLabelText("Nova tarefa") as HTMLInputElement;
}

beforeEach(() => vi.resetAllMocks());

describe("QuickAdd", () => {
  it("cria uma tarefa, limpa o campo e devolve o foco", async () => {
    api.createTask.mockResolvedValue(makeTask());
    const input = setup();
    fireEvent.change(input, { target: { value: "  Ligar para o cliente " } });
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-11-05" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(api.createTask).toHaveBeenCalledWith({
      title: "Ligar para o cliente",
      type: "tarefa",
      dueDate: "2026-11-05",
      caseId: null,
      fatal: false,
    });
    expect(input).toHaveFocus();
    expect(screen.getByLabelText("Data")).toHaveValue("");
  });

  it("sem data não envia dueDate", async () => {
    api.createTask.mockResolvedValue(makeTask());
    const input = setup();
    fireEvent.change(input, { target: { value: "Solta" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(api.createTask).toHaveBeenCalled());
    const body = api.createTask.mock.calls[0]![0];
    expect(body).toMatchObject({ title: "Solta", type: "tarefa" });
    expect("dueDate" in body).toBe(false);
  });

  it("mantém o texto e mostra o erro em caso de falha", async () => {
    api.createTask.mockRejectedValue(new ApiError(0, "rede", null));
    const input = setup();
    fireEvent.change(input, { target: { value: "Importante" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão com o servidor.");
    expect(input).toHaveValue("Importante");
  });

  it("ignora título vazio ou em branco", () => {
    const input = setup();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.submit(input.closest("form")!);
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it("envio duplo enquanto pendente gera uma só chamada", async () => {
    api.createTask.mockReturnValue(new Promise(() => {}));
    const input = setup();
    fireEvent.change(input, { target: { value: "Uma" } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(api.createTask).toHaveBeenCalled());
    expect(api.createTask).toHaveBeenCalledTimes(1);
  });
});
