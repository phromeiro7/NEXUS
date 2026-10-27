import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HolidayDto } from "@aj/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { HolidaysList } from "./holidays-list";

const api = { listHolidays: vi.fn(), createHoliday: vi.fn(), deleteHoliday: vi.fn() };
vi.mock("@/components/auth-provider", () => ({ useApi: () => api }));

const HOLIDAY: HolidayDto = { id: "h1", date: "2026-01-25", scope: "municipal", name: "Aniversário da cidade" };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HolidaysList />
    </QueryClientProvider>,
  );
}

function fill(date: string, name: string, scope = "estadual") {
  fireEvent.change(screen.getByLabelText("Data"), { target: { value: date } });
  fireEvent.change(screen.getByLabelText("Escopo"), { target: { value: scope } });
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: name } });
}

const add = () => fireEvent.click(screen.getByRole("button", { name: "Adicionar feriado" }));

beforeEach(() => {
  vi.resetAllMocks();
  api.listHolidays.mockResolvedValue([HOLIDAY]);
});

describe("HolidaysList", () => {
  it("lista data em pt-BR, escopo e nome", async () => {
    setup();
    const row = (await screen.findByText("Aniversário da cidade")).closest("li")!;
    expect(row).toHaveTextContent("25/01/2026");
    expect(row).toHaveTextContent("Municipal");
  });

  it("estado vazio", async () => {
    api.listHolidays.mockResolvedValue([]);
    setup();
    expect(await screen.findByText("Nenhum feriado local cadastrado.")).toBeInTheDocument();
  });

  it("cadastra enviando { date, scope, name }", async () => {
    api.createHoliday.mockResolvedValue({ id: "h2", date: "2026-07-09", scope: "estadual", name: "Revolução" });
    setup();
    await screen.findByText("Aniversário da cidade");
    fill("2026-07-09", "Revolução");
    add();
    await waitFor(() =>
      expect(api.createHoliday).toHaveBeenCalledWith({ date: "2026-07-09", scope: "estadual", name: "Revolução" }),
    );
    await waitFor(() => expect(screen.getByLabelText("Nome")).toHaveValue(""));
  });

  it("nome vazio ou data ausente bloqueia o envio com erro no campo", async () => {
    setup();
    await screen.findByText("Aniversário da cidade");
    add();
    expect(api.createHoliday).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Data")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Nome")).toHaveAttribute("aria-invalid", "true");
  });

  it("409 mostra a mensagem de duplicado e mantém os campos", async () => {
    api.createHoliday.mockRejectedValue(new ApiError(409, "feriado_ja_cadastrado", null));
    setup();
    await screen.findByText("Aniversário da cidade");
    fill("2026-01-25", "Aniversário da cidade", "municipal");
    add();
    expect(await screen.findByRole("alert")).toHaveTextContent("Este feriado já está cadastrado.");
    expect(screen.getByLabelText("Data")).toHaveValue("2026-01-25");
    expect(screen.getByLabelText("Nome")).toHaveValue("Aniversário da cidade");
    expect(screen.getByLabelText("Escopo")).toHaveValue("municipal");
  });

  it("remover só chama a API após confirmar", async () => {
    api.deleteHoliday.mockResolvedValue(undefined);
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Remover Aniversário da cidade" }));
    expect(screen.getByRole("dialog", { name: "Remover feriado?" })).toBeInTheDocument();
    expect(api.deleteHoliday).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sim, remover" }));
    await waitFor(() => expect(api.deleteHoliday).toHaveBeenCalledWith("h1"));
  });

  it("cancelar a remoção não chama a API", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Remover Aniversário da cidade" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(api.deleteHoliday).not.toHaveBeenCalled();
  });

  it("falha ao remover mostra a mensagem", async () => {
    api.deleteHoliday.mockRejectedValue(new ApiError(404, "nao_encontrado", null));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Remover Aniversário da cidade" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, remover" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não encontramos este item.");
  });
});
