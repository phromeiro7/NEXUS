import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { DeadlineCalculator } from "./deadline-calculator";

const api = { calculateDeadline: vi.fn(), listCases: vi.fn(), createTask: vi.fn() };
vi.mock("@/components/auth-provider", () => ({ useApi: () => api }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DeadlineCalculator />
    </QueryClientProvider>,
  );
}

const fill = (days = "15", countType = "uteis") => {
  fireEvent.change(screen.getByLabelText("Data da publicação"), { target: { value: "2026-11-02" } });
  fireEvent.change(screen.getByLabelText("Quantidade de dias"), { target: { value: days } });
  fireEvent.change(screen.getByLabelText("Tipo de contagem"), { target: { value: countType } });
};
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Calcular" }));

const result = (over = {}) => ({
  dueDate: "2026-11-24",
  prorrogado: false,
  feriadosDescontados: [{ date: "2026-11-15", name: "Proclamação da República" }],
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  api.listCases.mockResolvedValue([]);
});

describe("DeadlineCalculator", () => {
  it("envia exatamente { baseDate, days, countType }", async () => {
    api.calculateDeadline.mockResolvedValue(result());
    setup();
    fill("15", "corridos");
    submit();
    await screen.findByText(/Vence em/);
    expect(api.calculateDeadline).toHaveBeenCalledTimes(1);
    expect(api.calculateDeadline).toHaveBeenCalledWith({
      baseDate: "2026-11-02",
      days: 15,
      countType: "corridos",
    });
  });

  it("lista os feriados descontados e o aviso fixo", async () => {
    api.calculateDeadline.mockResolvedValue(result());
    setup();
    fill();
    submit();
    expect(await screen.findByText(/Proclamação da República/)).toBeInTheDocument();
    expect(
      screen.getByText("Confira sempre a contagem no tribunal; feriados locais dependem do seu cadastro."),
    ).toBeInTheDocument();
  });

  it("sem feriados diz que nenhum foi descontado", async () => {
    api.calculateDeadline.mockResolvedValue(result({ feriadosDescontados: [] }));
    setup();
    fill();
    submit();
    expect(await screen.findByText("Nenhum feriado descontado.")).toBeInTheDocument();
  });

  it("prorrogado mostra o texto; não prorrogado não", async () => {
    api.calculateDeadline.mockResolvedValue(result({ prorrogado: true }));
    setup();
    fill();
    submit();
    expect(await screen.findByText("Prorrogado para o próximo dia útil.")).toBeInTheDocument();
  });

  it("não prorrogado não mostra o texto", async () => {
    api.calculateDeadline.mockResolvedValue(result());
    setup();
    fill();
    submit();
    await screen.findByText(/Vence em/);
    expect(screen.queryByText(/Prorrogado/)).not.toBeInTheDocument();
  });

  it.each(["0", "366"])("%s dias bloqueia o envio e mostra erro", async (d) => {
    setup();
    fill(d);
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/1 a 365/);
    expect(api.calculateDeadline).not.toHaveBeenCalled();
  });

  it("erro da API aparece e mantém os valores", async () => {
    api.calculateDeadline.mockRejectedValue(new ApiError(0, "rede", null));
    setup();
    fill("20", "corridos");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão com o servidor.");
    expect(screen.getByLabelText("Data da publicação")).toHaveValue("2026-11-02");
    expect(screen.getByLabelText("Quantidade de dias")).toHaveValue(20);
    expect(screen.getByLabelText("Tipo de contagem")).toHaveValue("corridos");
  });

  it("envio duplo gera uma só chamada", async () => {
    api.calculateDeadline.mockReturnValue(new Promise(() => {}));
    setup();
    fill();
    const form = screen.getByLabelText("Data da publicação").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(api.calculateDeadline).toHaveBeenCalled());
    expect(api.calculateDeadline).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Calculando…" })).toBeDisabled();
  });

  it("'Criar tarefa' só existe após o resultado e abre o formulário com a regra", async () => {
    api.calculateDeadline.mockResolvedValue(result());
    setup();
    expect(screen.queryByRole("button", { name: "Criar tarefa com este prazo" })).not.toBeInTheDocument();
    fill("10", "corridos");
    submit();
    fireEvent.click(await screen.findByRole("button", { name: "Criar tarefa com este prazo" }));
    const panel = screen.getByRole("region", { name: "Nova tarefa com prazo" });
    expect(within(panel).getByLabelText("Título")).toHaveValue("");
    expect(within(panel).getByLabelText("Calcular prazo")).toBeChecked();
    expect(within(panel).getByLabelText("Data base")).toHaveValue("2026-11-02");
    expect(within(panel).getByLabelText("Dias")).toHaveValue(10);
    expect(within(panel).getByLabelText("Contagem")).toHaveValue("corridos");
  });
});
