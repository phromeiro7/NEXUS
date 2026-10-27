import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { messageFor } from "@/lib/messages";
import { makeTask } from "@/test/factories";
import { TaskForm } from "./task-form";

const api = {
  createTask: vi.fn(),
  updateTask: vi.fn(),
  listCases: vi.fn(),
  calculateDeadline: vi.fn(),
};
vi.mock("@/components/auth-provider", () => ({ useApi: () => api }));

const onDone = vi.fn();

function setup(props: Partial<React.ComponentProps<typeof TaskForm>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TaskForm onDone={onDone} {...props} />
    </QueryClientProvider>,
  );
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.resetAllMocks();
  api.listCases.mockResolvedValue([]);
});

describe("TaskForm", () => {
  it("título vazio bloqueia o envio e mostra o erro no campo", async () => {
    setup();
    type("Título", "   ");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Informe um título de até 200 caracteres.")).toBeInTheDocument();
    expect(screen.getByLabelText("Título")).toHaveAttribute("aria-invalid", "true");
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it("a hora fica desabilitada sem data", () => {
    setup();
    expect(screen.getByLabelText("Hora")).toBeDisabled();
    type("Data", "2026-11-05");
    expect(screen.getByLabelText("Hora")).toBeEnabled();
  });

  it("422 hora_invalida mostra a mensagem junto da hora e mantém os campos", async () => {
    const error = new ApiError(422, "hora_invalida", { error: "hora_invalida", reason: "hora_inexistente" });
    api.createTask.mockRejectedValue(error);
    setup();
    type("Título", "Audiência X");
    type("Data", "2026-11-05");
    type("Hora", "02:30");
    fireEvent.click(screen.getByLabelText("Fatal"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(messageFor(error))).toBeInTheDocument();
    expect(screen.getByLabelText("Hora")).toHaveAccessibleDescription(messageFor(error));
    expect(screen.getByLabelText("Título")).toHaveValue("Audiência X");
    expect(screen.getByLabelText("Data")).toHaveValue("2026-11-05");
    expect(screen.getByLabelText("Hora")).toHaveValue("02:30");
    expect(screen.getByLabelText("Fatal")).toBeChecked();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("400 entrada_invalida com issues vira erro de campo", async () => {
    api.createTask.mockRejectedValue(
      new ApiError(400, "entrada_invalida", { error: "entrada_invalida", issues: [{ path: ["title"], message: "x" }] }),
    );
    setup();
    type("Título", "Algo");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Informe um título de até 200 caracteres.")).toBeInTheDocument();
    expect(screen.getByLabelText("Título")).toHaveValue("Algo");
  });

  it("outro erro aparece em região de alerta sem limpar os campos", async () => {
    api.createTask.mockRejectedValue(new ApiError(0, "rede", null));
    setup();
    type("Título", "Algo");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão com o servidor.");
    expect(screen.getByLabelText("Título")).toHaveValue("Algo");
  });

  it("modo prazo envia deadline e não dueDate, mostrando data e feriados", async () => {
    api.calculateDeadline.mockResolvedValue({
      dueDate: "2026-10-22",
      prorrogado: false,
      feriadosDescontados: [{ date: "2026-10-12", name: "Nossa Senhora Aparecida" }],
    });
    api.createTask.mockResolvedValue(makeTask());
    setup();
    type("Título", "Contestação");
    fireEvent.click(screen.getByLabelText("Calcular prazo"));
    type("Data base", "2026-10-01");
    type("Dias", "15");
    fireEvent.click(screen.getByRole("button", { name: "Calcular" }));
    expect(await screen.findByText(/22 de outubro de 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Nossa Senhora Aparecida/)).toBeInTheDocument();
    expect(api.calculateDeadline).toHaveBeenCalledWith({ baseDate: "2026-10-01", days: 15, countType: "uteis" });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledTimes(1));
    const body = api.createTask.mock.calls[0]![0];
    expect(body.deadline).toEqual({ baseDate: "2026-10-01", days: 15, countType: "uteis" });
    expect("dueDate" in body && body.dueDate != null).toBe(false);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("modo prazo exige calcular antes de salvar", async () => {
    setup();
    type("Título", "Contestação");
    fireEvent.click(screen.getByLabelText("Calcular prazo"));
    type("Data base", "2026-10-01");
    type("Dias", "15");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Calcule o prazo antes de salvar.")).toBeInTheDocument();
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it("initial pré-preenche, inclusive a regra de prazo", () => {
    setup({
      initial: { title: "Réplica", type: "prazo", deadline: { baseDate: "2026-10-01", days: 10, countType: "corridos" } },
    });
    expect(screen.getByLabelText("Título")).toHaveValue("Réplica");
    expect(screen.getByLabelText("Calcular prazo")).toBeChecked();
    expect(screen.getByLabelText("Data base")).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("Dias")).toHaveValue(10);
    expect(screen.getByLabelText("Contagem")).toHaveValue("corridos");
  });

  it("editar envia só os campos alterados", async () => {
    api.updateTask.mockResolvedValue(makeTask());
    setup({ task: makeTask({ id: "t9", title: "Antigo", dueDate: "2026-10-27" }) });
    type("Título", "Novo");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith("t9", { title: "Novo" }));
    expect(api.updateTask).toHaveBeenCalledTimes(1);
  });

  it("editar sem alterações não chama a API", async () => {
    setup({ task: makeTask() });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nenhuma alteração para salvar.");
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it("envio duplo enquanto pendente gera uma só chamada", async () => {
    api.createTask.mockReturnValue(new Promise(() => {}));
    setup();
    type("Título", "Algo");
    const form = screen.getByRole("button", { name: "Salvar" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(api.createTask).toHaveBeenCalled());
    expect(api.createTask).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Salvando…" })).toBeDisabled();
  });
});
