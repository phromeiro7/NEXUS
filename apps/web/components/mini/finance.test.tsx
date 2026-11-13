import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { Lancamento } from "@/lib/finance";
import { createFakeFinanceApi } from "@/test/fake-finance-api";
import { EntryEdit, EntryForm } from "./entry-form";
import { FinanceScreen } from "./finance-screen";
import { ToastProvider } from "./toast";

const push = vi.fn();
const holder = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/mini/financas",
}));
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ userId: "u1" }),
  useApi: () => holder.api,
}));
vi.mock("@/hooks/use-today", () => ({ useToday: () => "2026-11-04" }));

let fake: ReturnType<typeof createFakeFinanceApi>;
const LOCAL_KEY = "nexus:financas:v1:u1";

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

const saved = () => [...fake.rows.values()];

beforeEach(() => {
  localStorage.clear();
  fake = createFakeFinanceApi();
  holder.api = fake.api;
  push.mockClear();
});

describe("EntryForm", () => {
  it("não salva sem valor e sem descrição: mostra o que falta e foca o primeiro campo", async () => {
    wrap(<EntryForm />);
    await userEvent.click(screen.getByRole("button", { name: "Salvar lançamento" }));
    expect(screen.getByText("Digite um valor maior que zero, como 119,90.")).toBeInTheDocument();
    expect(screen.getByText(/Diga o que foi/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Valor/)).toHaveFocus();
    expect(fake.api.createFinanceEntry).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("rejeita valor zero ou texto", async () => {
    wrap(<EntryForm />);
    await userEvent.type(screen.getByLabelText(/Valor/), "abc");
    await userEvent.type(screen.getByLabelText("O que foi"), "Almoço");
    await userEvent.click(screen.getByRole("button", { name: "Salvar lançamento" }));
    expect(screen.getByText(/Digite um valor maior que zero/)).toBeInTheDocument();
    expect(fake.api.createFinanceEntry).not.toHaveBeenCalled();
  });

  it("salva um gasto já pago em centavos pela API e volta às Finanças", async () => {
    wrap(<EntryForm />);
    await userEvent.type(screen.getByLabelText(/Valor/), "119,90");
    await userEvent.type(screen.getByLabelText("O que foi"), "Internet");
    await userEvent.click(screen.getByRole("button", { name: "Moradia" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar lançamento" }));
    await waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0]).toMatchObject({
      kind: "gasto",
      description: "Internet",
      amountCents: 11990,
      category: "Moradia",
      dueDate: "2026-11-04",
      status: "paga",
      reminderTime: null,
    });
    expect(saved()[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(push).toHaveBeenCalledWith("/mini/financas");
    expect(screen.getByRole("status")).toHaveTextContent("Gasto anotado: Internet, R$ 119,90.");
  });

  it("Vou pagar vira conta com vencimento e lembrete; Desfazer apaga na API", async () => {
    wrap(<EntryForm />);
    await userEvent.type(screen.getByLabelText(/Valor/), "1.200");
    await userEvent.type(screen.getByLabelText("O que foi"), "Aluguel");
    await userEvent.click(screen.getByRole("button", { name: "Vou pagar" }));
    expect(screen.getByLabelText("Vence em")).toBeInTheDocument();
    expect(screen.getByText("Lembrete anotado: hoje às 9h.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Salvar lançamento" }));
    await waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0]).toMatchObject({ kind: "conta", status: "a_pagar", amountCents: 120000, reminderTime: "09:00" });
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(saved()).toHaveLength(0));
  });

  it("entrada troca as categorias e os rótulos de situação", async () => {
    wrap(<EntryForm />);
    await userEvent.click(screen.getByRole("button", { name: "Entrada" }));
    expect(screen.getByRole("button", { name: "Freela" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mercado" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Já recebi" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Valor/), "1500");
    await userEvent.type(screen.getByLabelText("O que foi"), "Freela do site");
    await userEvent.click(screen.getByRole("button", { name: "Salvar lançamento" }));
    await waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0]).toMatchObject({ kind: "entrada", status: "paga", amountCents: 150000 });
  });
});

describe("FinanceScreen", () => {
  it("sem lançamentos: estado vazio honesto, sem números", async () => {
    wrap(<FinanceScreen />);
    expect(await screen.findByText("Nada anotado neste mês")).toBeInTheDocument();
    expect(screen.queryByText("Entrou")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Anotar gasto, conta ou entrada/ })).toHaveAttribute("href", "/mini/financas/novo");
  });

  it("enquanto carrega não afirma que não há nada", async () => {
    let release: () => void = () => {};
    fake.api.listFinanceEntries.mockImplementationOnce(() => new Promise((res) => (release = () => res([]))));
    wrap(<FinanceScreen />);
    expect(screen.getByRole("status", { name: "Carregando lançamentos" })).toBeInTheDocument();
    expect(screen.queryByText("Nada anotado neste mês")).not.toBeInTheDocument();
    release();
    expect(await screen.findByText("Nada anotado neste mês")).toBeInTheDocument();
  });

  it("Paguei move a conta de 'ainda a pagar' para 'saiu' e Desfazer volta, pela API", async () => {
    fake.seed({ kind: "entrada", description: "Salário", amountCents: 500000 });
    const bill = fake.seed({ kind: "conta", description: "Internet", amountCents: 11990, status: "a_pagar" });
    wrap(<FinanceScreen />);
    const row = (label: string) => screen.getByText(label).closest("div")!;
    expect(await screen.findByText("Sobram R$ 4.880,10 depois das contas")).toBeInTheDocument();
    expect(row("Ainda a pagar")).toHaveTextContent("R$ 119,90");
    expect(row("Saiu")).toHaveTextContent("R$ 0,00");

    await userEvent.click(screen.getByRole("button", { name: "Marcar Internet como paga" }));
    expect(row("Saiu")).toHaveTextContent("R$ 119,90");
    expect(row("Ainda a pagar")).toHaveTextContent("R$ 0,00");
    expect(screen.queryByRole("button", { name: "Marcar Internet como paga" })).not.toBeInTheDocument();
    await waitFor(() => expect(fake.rows.get(bill.id)).toMatchObject({ status: "paga" }));
    expect(fake.api.updateFinanceEntry).toHaveBeenCalledWith(bill.id, { status: "paga" });

    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(fake.rows.get(bill.id)).toMatchObject({ status: "a_pagar", paidAt: null }));
    expect(row("Ainda a pagar")).toHaveTextContent("R$ 119,90");
    expect(screen.getByRole("button", { name: "Marcar Internet como paga" })).toBeInTheDocument();
  });

  it("navega entre meses sem misturar os dados", async () => {
    fake.seed({ kind: "gasto", description: "Mercado", amountCents: 8000, dueDate: "2026-10-30" });
    wrap(<FinanceScreen />);
    expect(await screen.findByText("Nada anotado neste mês")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    expect(screen.getByRole("heading", { name: "Outubro" })).toBeInTheDocument();
    expect(screen.getByText("Saiu").closest("div")).toHaveTextContent("R$ 80,00");
  });

  it("'Para onde foi' só aparece com gastos categorizados", async () => {
    fake.seed({ kind: "gasto", description: "Camiseta", amountCents: 10000 });
    wrap(<FinanceScreen />);
    expect(await screen.findByText("Entrou")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Para onde foi" })).not.toBeInTheDocument();
  });

  it("mostra 'Para onde foi' quando há gasto com categoria", async () => {
    fake.seed({ kind: "gasto", description: "Feira", amountCents: 5000, category: "Mercado" });
    wrap(<FinanceScreen />);
    expect(await screen.findByRole("heading", { name: "Para onde foi" })).toBeInTheDocument();
  });

  it("falha ao carregar: avisa, não afirma que está vazio e Tentar de novo recarrega", async () => {
    fake.api.listFinanceEntries.mockRejectedValueOnce(new ApiError(0, "rede", null));
    fake.seed({ kind: "gasto", description: "Feira", amountCents: 5000, category: "Mercado" });
    wrap(<FinanceScreen />);
    expect(await screen.findByText(/Não foi possível carregar seus lançamentos/)).toBeInTheDocument();
    expect(screen.queryByText("Nada anotado neste mês")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("heading", { name: "Para onde foi" })).toBeInTheDocument();
    expect(screen.queryByText(/Não foi possível carregar/)).not.toBeInTheDocument();
  });

  it("se a API recusar o pagamento, a tela volta ao que está guardado e avisa", async () => {
    const bill = fake.seed({ kind: "conta", description: "Internet", amountCents: 11990, status: "a_pagar" });
    fake.api.updateFinanceEntry.mockRejectedValueOnce(new ApiError(500, "erro_interno", null));
    wrap(<FinanceScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Marcar Internet como paga" }));
    expect(await screen.findByText(/Não foi possível salvar a última alteração/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar Internet como paga" })).toBeInTheDocument();
    expect(fake.rows.get(bill.id)).toMatchObject({ status: "a_pagar" });
  });
});

describe("FinanceScreen: excluir e editar", () => {
  it("lista o que já foi pago e permite excluir, com Desfazer", async () => {
    const gasto = fake.seed({ kind: "gasto", description: "Almoço", amountCents: 4200, category: "Lazer" });
    wrap(<FinanceScreen />);
    expect(await screen.findByRole("heading", { name: /Já lançados/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Excluir Almoço" }));
    expect(screen.queryByText("Almoço")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Lançamento excluído: Almoço.");
    await waitFor(() => expect(fake.rows.has(gasto.id)).toBe(false));
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(fake.rows.has(gasto.id)).toBe(true));
    expect(await screen.findByText("Almoço")).toBeInTheDocument();
  });

  it("conta a pagar também pode ser excluída e abre a edição pelo toque", async () => {
    const bill = fake.seed({ kind: "conta", description: "Internet", amountCents: 11990, status: "a_pagar" });
    wrap(<FinanceScreen />);
    expect(await screen.findByRole("link", { name: "Editar Internet" })).toHaveAttribute("href", `/mini/financas/${bill.id}`);
    await userEvent.click(screen.getByRole("button", { name: "Excluir Internet" }));
    await waitFor(() => expect(fake.rows.has(bill.id)).toBe(false));
  });

  it("se a API recusar a exclusão, o lançamento volta e a tela avisa", async () => {
    const gasto = fake.seed({ kind: "gasto", description: "Almoço", amountCents: 4200 });
    fake.api.deleteFinanceEntry.mockRejectedValueOnce(new ApiError(500, "erro_interno", null));
    wrap(<FinanceScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Excluir Almoço" }));
    expect(await screen.findByText(/Não foi possível salvar a última alteração/)).toBeInTheDocument();
    expect(await screen.findByText("Almoço")).toBeInTheDocument();
    expect(fake.rows.has(gasto.id)).toBe(true);
  });
});

describe("EntryEdit", () => {
  it("abre com os dados do lançamento e salva só o que mudou, em centavos", async () => {
    const gasto = fake.seed({ kind: "gasto", description: "Almoço", amountCents: 4200, category: "Lazer" });
    wrap(<EntryEdit id={gasto.id} />);
    const valor = await screen.findByLabelText(/Valor/);
    expect(valor).toHaveValue("42,00");
    expect(screen.getByLabelText("O que foi")).toHaveValue("Almoço");
    expect(screen.getByRole("button", { name: "Lazer" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Entrada" })).not.toBeInTheDocument();
    await userEvent.clear(valor);
    await userEvent.type(valor, "45,50");
    await userEvent.click(screen.getByRole("button", { name: "Mercado" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(fake.rows.get(gasto.id)).toMatchObject({ amountCents: 4550, category: "Mercado", description: "Almoço", kind: "gasto", status: "paga" }));
    expect(fake.api.updateFinanceEntry).toHaveBeenCalledWith(gasto.id, { amountCents: 4550, category: "Mercado" });
    expect(push).toHaveBeenCalledWith("/mini/financas");
    // Desfazer devolve os valores anteriores.
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(fake.rows.get(gasto.id)).toMatchObject({ amountCents: 4200, category: "Lazer" }));
  });

  it("conta a pagar: muda vencimento e lembrete, e mantém a situação", async () => {
    const bill = fake.seed({ kind: "conta", description: "Aluguel", amountCents: 120000, status: "a_pagar", dueDate: "2026-11-05", reminderTime: "09:00" });
    wrap(<EntryEdit id={bill.id} />);
    const data = await screen.findByLabelText("Vence em");
    fireEvent.change(data, { target: { value: "2026-11-10" } });
    fireEvent.change(screen.getByLabelText("Lembrar às"), { target: { value: "" } });
    await userEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(fake.rows.get(bill.id)).toMatchObject({ dueDate: "2026-11-10", reminderTime: null, status: "a_pagar", paidAt: null }));
    expect(fake.api.updateFinanceEntry).toHaveBeenCalledWith(bill.id, { dueDate: "2026-11-10", reminderTime: null });
  });

  it("valida como no cadastro e não chama a API", async () => {
    const gasto = fake.seed({ kind: "gasto", description: "Almoço", amountCents: 4200 });
    wrap(<EntryEdit id={gasto.id} />);
    const valor = await screen.findByLabelText(/Valor/);
    await userEvent.clear(valor);
    await userEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(screen.getByText(/Digite um valor maior que zero/)).toBeInTheDocument();
    expect(fake.api.updateFinanceEntry).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("sem mudanças, não chama a API", async () => {
    const gasto = fake.seed({ kind: "gasto", description: "Almoço", amountCents: 4200 });
    wrap(<EntryEdit id={gasto.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Salvar alterações" }));
    expect(fake.api.updateFinanceEntry).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/mini/financas");
  });

  it("id inexistente: explica e oferece voltar", async () => {
    wrap(<EntryEdit id="nao-existe" />);
    expect(await screen.findByText("Não encontramos esse lançamento.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Finanças/ })).toHaveAttribute("href", "/mini/financas");
  });

  it("se a API recusar a edição, a tela volta ao valor guardado e avisa", async () => {
    const gasto = fake.seed({ kind: "gasto", description: "Almoço", amountCents: 4200 });
    fake.api.updateFinanceEntry.mockRejectedValueOnce(new ApiError(500, "erro_interno", null));
    wrap(
      <>
        <EntryEdit id={gasto.id} />
        <FinanceScreen />
      </>,
    );
    const valor = (await screen.findAllByLabelText(/Valor/))[0]!;
    await userEvent.clear(valor);
    await userEvent.type(valor, "99");
    await userEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect((await screen.findAllByText(/Não foi possível salvar a última alteração/)).length).toBeGreaterThan(0);
    expect(fake.rows.get(gasto.id)).toMatchObject({ amountCents: 4200 });
  });
});

describe("importação do que ficou só neste aparelho", () => {
  const local = (over: Partial<Lancamento> = {}): Lancamento => ({
    id: crypto.randomUUID(),
    tipo: "gasto",
    descricao: "Almoço",
    valorCentavos: 4200,
    categoria: null,
    data: "2026-11-03",
    situacao: "paga",
    lembreteHora: null,
    criadoEm: "2026-11-03T15:00:00.000Z",
    ...over,
  });

  it("sem dados locais, não oferece nada", async () => {
    wrap(<FinanceScreen />);
    await screen.findByText("Nada anotado neste mês");
    expect(screen.queryByRole("button", { name: /Importar/ })).not.toBeInTheDocument();
  });

  it("importa com os mesmos ids, limpa o aparelho e os lançamentos passam a vir da API", async () => {
    const a = local();
    const b = local({ tipo: "conta", descricao: "Aluguel", situacao: "a_pagar", lembreteHora: "09:00", data: "2026-11-05" });
    localStorage.setItem(LOCAL_KEY, JSON.stringify([a, b, { lixo: true }]));
    wrap(<FinanceScreen />);
    expect(await screen.findByText(/Há 2 lançamentos salvos só neste aparelho/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Importar para a sua conta" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Importar para a sua conta" })).not.toBeInTheDocument());
    expect(saved().map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
    expect(fake.rows.get(b.id)).toMatchObject({ kind: "conta", status: "a_pagar", reminderTime: "09:00", amountCents: 4200 });
    expect(localStorage.getItem(LOCAL_KEY)).toBeNull();
    expect(await screen.findByText("Aluguel")).toBeInTheDocument();
  });

  it("repetir a importação não duplica (409 conta como já importado)", async () => {
    const a = local();
    fake.seed({ id: a.id, kind: "gasto", description: "Almoço", amountCents: 4200 });
    localStorage.setItem(LOCAL_KEY, JSON.stringify([a]));
    wrap(<FinanceScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Importar para a sua conta" }));
    await waitFor(() => expect(localStorage.getItem(LOCAL_KEY)).toBeNull());
    expect(saved()).toHaveLength(1);
  });

  it("se a API falhar, mantém os dados do aparelho e deixa tentar de novo", async () => {
    const a = local();
    localStorage.setItem(LOCAL_KEY, JSON.stringify([a]));
    fake.api.createFinanceEntry.mockRejectedValueOnce(new ApiError(500, "erro_interno", null));
    wrap(<FinanceScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Importar para a sua conta" }));
    expect(await screen.findByText(/Não deu para importar agora/)).toBeInTheDocument();
    expect(localStorage.getItem(LOCAL_KEY)).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Importar para a sua conta" }));
    await waitFor(() => expect(localStorage.getItem(LOCAL_KEY)).toBeNull());
    expect(saved()).toHaveLength(1);
  });

  it("Descartar apaga só os dados do aparelho, sem tocar na API", async () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify([local()]));
    wrap(<FinanceScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Descartar do aparelho" }));
    expect(localStorage.getItem(LOCAL_KEY)).toBeNull();
    expect(fake.api.createFinanceEntry).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Importar/ })).not.toBeInTheDocument();
  });
});
