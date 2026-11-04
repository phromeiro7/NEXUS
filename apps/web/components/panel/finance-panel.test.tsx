import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/mini/toast";
import { ApiError } from "@/lib/api";
import { createFakeFinanceApi } from "@/test/fake-finance-api";
import { FinancePanel } from "./finance-panel";
import { ShortcutsProvider } from "./shortcuts";

const holder = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ userId: "u1" }),
  useApi: () => holder.api,
}));
vi.mock("@/hooks/use-today", () => ({ useToday: () => "2026-11-04" }));

let fake: ReturnType<typeof createFakeFinanceApi>;

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ShortcutsProvider>
          <FinancePanel />
        </ShortcutsProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** Descrições na ordem em que aparecem na tabela (primeira coluna de texto em negrito). */
const order = () =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .filter((r) => r.closest("tbody"))
    .map((r) => within(r).getAllByRole("cell")[1]!.textContent);

beforeEach(() => {
  localStorage.clear();
  fake = createFakeFinanceApi();
  fake.seed({ kind: "gasto", description: "Supermercado", category: "Mercado", amountCents: 8640, dueDate: "2026-11-04" });
  fake.seed({ kind: "gasto", description: "Almoço", category: "Lazer", amountCents: 4200, dueDate: "2026-11-03" });
  fake.seed({ kind: "entrada", description: "Freela: site da clínica", category: "Freela", amountCents: 150000, dueDate: "2026-11-03" });
  fake.seed({ kind: "conta", description: "Aluguel", category: "Moradia", amountCents: 120000, status: "a_pagar", dueDate: "2026-11-05", reminderTime: "09:00" });
  fake.seed({ kind: "conta", description: "Luz", category: "Moradia", amountCents: 18740, status: "a_pagar", dueDate: "2026-11-02" });
  fake.seed({ kind: "gasto", description: "Cinema", category: "Lazer", amountCents: 4800, dueDate: "2026-10-30" });
  holder.api = { ...fake.api, interpretCapture: vi.fn() };
});

describe("FinancePanel", () => {
  it("mostra o título, o subtítulo, o mês, a frase e os totais", async () => {
    renderPanel();
    expect(await screen.findByRole("heading", { level: 1, name: "Finanças" })).toBeInTheDocument();
    expect(screen.getByText("Gastos, entradas e contas do mês")).toBeInTheDocument();
    expect(screen.getByText("Novembro")).toBeInTheDocument();
    // entrou 1.500 − saiu 128,40 − a pagar 1.387,40 = −15,80
    expect(await screen.findByText("Faltam R$ 15,80 para fechar as contas.")).toBeInTheDocument();
    const facts = screen.getByText("Entrou").closest("dl")!;
    expect(facts).toHaveTextContent("Entrou" + "R$ 1.500,00");
    expect(facts).toHaveTextContent("Saiu" + "R$ 128,40");
    expect(facts).toHaveTextContent("Falta pagar" + "R$ 1.387,40");
  });

  it("a barra de captura aparece em Finanças", async () => {
    renderPanel();
    expect(await screen.findByLabelText("Nova tarefa ou lançamento")).toBeInTheDocument();
  });

  it("a tabela tem cabeçalhos semânticos e só os lançamentos do mês", async () => {
    renderPanel();
    await screen.findByText("Supermercado", { selector: "td" });
    const table = screen.getByRole("table", { name: "Lançamentos do mês" });
    for (const name of ["Data", "Descrição", "Categoria", "Situação", "Valor"]) expect(within(table).getByRole("columnheader", { name: new RegExp(name) })).toBeInTheDocument();
    expect(order()).toHaveLength(5);
    expect(order()).not.toContain("Cinema");
  });

  it("por padrão ordena pela data, do mais recente ao mais antigo, e o total acompanha a tabela", async () => {
    renderPanel();
    await screen.findByText("Aluguel", { selector: "td" });
    expect(order()[0]).toBe("Aluguel");
    expect(order().at(-1)).toBe("Luz");
    expect(screen.getByText("Total do que está na tabela").closest("tr")).toHaveTextContent("−R$ 15,80");
  });

  it("filtros Gastos, Entradas e Contas", async () => {
    renderPanel();
    await screen.findByText("Aluguel", { selector: "td" });
    await userEvent.click(screen.getByRole("button", { name: "Gastos" }));
    expect(order().sort()).toEqual(["Almoço", "Supermercado"]);
    await userEvent.click(screen.getByRole("button", { name: "Entradas" }));
    expect(order()).toEqual(["Freela: site da clínica"]);
    await userEvent.click(screen.getByRole("button", { name: "Contas" }));
    expect(order().sort()).toEqual(["Aluguel", "Luz"]);
    await userEvent.click(screen.getByRole("button", { name: "Tudo" }));
    expect(order()).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Tudo" })).toHaveAttribute("aria-pressed", "true");
  });

  it("busca por nome ou categoria, sem acento, e mostra o vazio do filtro", async () => {
    renderPanel();
    await screen.findByText("Aluguel", { selector: "td" });
    await userEvent.type(screen.getByLabelText("Buscar lançamento"), "almoco");
    expect(order()).toEqual(["Almoço"]);
    await userEvent.clear(screen.getByLabelText("Buscar lançamento"));
    await userEvent.type(screen.getByLabelText("Buscar lançamento"), "moradia");
    expect(order().sort()).toEqual(["Aluguel", "Luz"]);
    await userEvent.clear(screen.getByLabelText("Buscar lançamento"));
    await userEvent.type(screen.getByLabelText("Buscar lançamento"), "zzz");
    expect(screen.getByText("Nenhum lançamento com esse filtro ou busca.")).toBeInTheDocument();
  });

  it("ordena por valor e por descrição, e o cabeçalho informa o sentido", async () => {
    renderPanel();
    await screen.findByText("Aluguel", { selector: "td" });
    await userEvent.click(screen.getByRole("button", { name: /^Valor/ }));
    expect(order()[0]).toBe("Freela: site da clínica");
    expect(screen.getByRole("columnheader", { name: /Valor/ })).toHaveAttribute("aria-sort", "descending");
    await userEvent.click(screen.getByRole("button", { name: /^Valor/ }));
    expect(order()[0]).toBe("Almoço");
    expect(screen.getByRole("columnheader", { name: /Valor/ })).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(screen.getByRole("button", { name: /^Descrição/ }));
    expect(order().slice(0, 2)).toEqual(["Almoço", "Aluguel"]);
  });

  it("dá o estado de cada lançamento e destaca o vencido", async () => {
    renderPanel();
    const luz = (await screen.findByText("Luz", { selector: "td" })).closest("tr")!;
    expect(within(luz).getByText("Venceu em 02/11")).toHaveClass("pn-status-late");
    const aluguel = screen.getByText("Aluguel", { selector: "td" }).closest("tr")!;
    expect(within(aluguel).getByText("Vence amanhã")).not.toHaveClass("pn-status-late");
    expect(within(screen.getByText("Supermercado", { selector: "td" }).closest("tr")!).getByText("Pago")).toBeInTheDocument();
    expect(within(screen.getByText("Freela: site da clínica", { selector: "td" }).closest("tr")!).getByText("Recebido")).toBeInTheDocument();
  });

  it("Paguei dá baixa na conta e Desfazer volta a pagar; o que já foi pago não tem o botão", async () => {
    renderPanel();
    const aluguel = (await screen.findByText("Aluguel", { selector: "td" })).closest("tr")!;
    expect(within(screen.getByText("Supermercado", { selector: "td" }).closest("tr")!).queryByRole("button", { name: /^Paguei/ })).not.toBeInTheDocument();
    await userEvent.click(within(aluguel).getByRole("button", { name: "Paguei: Aluguel" }));
    await waitFor(() => expect(fake.api.updateFinanceEntry).toHaveBeenCalledWith(expect.any(String), { status: "paga" }));
    await waitFor(() => expect(within(screen.getByText("Aluguel", { selector: "td" }).closest("tr")!).getByText("Pago")).toBeInTheDocument());
    const toast = screen.getAllByRole("status").find((n) => n.textContent?.includes("Conta paga: Aluguel"))!;
    await userEvent.click(within(toast).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(fake.api.updateFinanceEntry).toHaveBeenLastCalledWith(expect.any(String), { status: "a_pagar" }));
  });

  it("Excluir apaga e Desfazer traz o lançamento de volta com o mesmo id", async () => {
    renderPanel();
    const row = (await screen.findByText("Almoço", { selector: "td" })).closest("tr")!;
    const id = [...fake.rows.values()].find((r) => r.description === "Almoço")!.id;
    await userEvent.click(within(row).getByRole("button", { name: "Excluir: Almoço" }));
    await waitFor(() => expect(fake.rows.has(id)).toBe(false));
    expect(screen.queryByText("Almoço", { selector: "td" })).not.toBeInTheDocument();
    const toast = screen.getAllByRole("status").find((n) => n.textContent?.includes("Lançamento excluído"))!;
    await userEvent.click(within(toast).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(fake.rows.has(id)).toBe(true));
  });

  it("troca de mês: outubro tem só o seu lançamento e novembro de volta traz os outros", async () => {
    renderPanel();
    await screen.findByText("Aluguel", { selector: "td" });
    await userEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    expect(screen.getByText("Outubro")).toBeInTheDocument();
    expect(order()).toEqual(["Cinema"]);
    await userEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    await userEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    expect(screen.getByText("Dezembro")).toBeInTheDocument();
    expect(screen.getByText(/Nada anotado em Dezembro/)).toBeInTheDocument();
    expect(screen.getByText("Nada anotado neste mês.")).toBeInTheDocument();
  });

  it("Novo lançamento abre um diálogo, salva e fecha", async () => {
    renderPanel();
    await screen.findByText("Aluguel", { selector: "td" });
    await userEvent.click(screen.getByRole("button", { name: "Novo lançamento" }));
    const dialog = screen.getByRole("dialog", { name: "Novo lançamento" });
    await userEvent.type(within(dialog).getByLabelText(/Valor/), "119,90");
    await userEvent.type(within(dialog).getByLabelText("O que foi"), "Internet");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar lançamento" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect([...fake.rows.values()].find((r) => r.description === "Internet")).toMatchObject({ kind: "gasto", amountCents: 11990, status: "paga" });
    expect(await screen.findByText("Internet", { selector: "td" })).toBeInTheDocument();
  });

  it("o diálogo não salva sem valor e Esc fecha sem gravar", async () => {
    renderPanel();
    await screen.findByText("Aluguel", { selector: "td" });
    const before = fake.rows.size;
    await userEvent.click(screen.getByRole("button", { name: "Novo lançamento" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar lançamento" }));
    expect(screen.getByText(/Digite um valor maior que zero/)).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fake.rows.size).toBe(before);
  });

  it("falha ao carregar avisa com Tentar de novo", async () => {
    fake.api.listFinanceEntries.mockRejectedValueOnce(new ApiError(500, "erro", null));
    renderPanel();
    expect(await screen.findByText(/Não foi possível carregar seus lançamentos/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Aluguel", { selector: "td" })).toBeInTheDocument();
  });

  it("avisa dos lançamentos que existem só neste aparelho e importa", async () => {
    localStorage.setItem(
      "nexus:financas:v1:u1",
      JSON.stringify([{ id: "0b6f0c4e-1c1e-4e2a-9d3a-5f7f2d9f6a11", tipo: "gasto", descricao: "Café", valorCentavos: 900, categoria: null, data: "2026-11-04", situacao: "paga", lembreteHora: null, criadoEm: "2026-11-04T10:00:00.000Z" }]),
    );
    renderPanel();
    expect(await screen.findByText(/Há 1 lançamento salvo só neste aparelho/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Importar para a sua conta" }));
    await waitFor(() => expect([...fake.rows.values()].some((r) => r.description === "Café")).toBe(true));
  });
});
