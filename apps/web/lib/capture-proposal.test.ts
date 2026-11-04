import type { CaptureProposalDto, IsoDate } from "@aj/shared";
import { describe, expect, it } from "vitest";
import {
  canConfirm,
  categoryOptions,
  dayOptions,
  proposalNote,
  proposalSummary,
  timeOptions,
  toCreation,
  withCategory,
  withDay,
  withTime,
} from "./capture-proposal";

const today = "2026-11-04" as IsoDate;

const gasto: CaptureProposalDto = { kind: "gasto", description: "roupa", amountCents: 10000, category: "Roupas", date: today, time: null, status: "paga" };
const conta: CaptureProposalDto = { kind: "conta", description: "luz", amountCents: 18740, category: "Moradia", date: "2026-11-08" as IsoDate, time: null, status: "a_pagar" };
const contaSemData: CaptureProposalDto = { ...conta, date: null };
const entrada: CaptureProposalDto = { kind: "entrada", description: "freela", amountCents: 150000, category: "Freela", date: today, time: null, status: "paga" };
const tarefa: CaptureProposalDto = { kind: "tarefa", title: "ligar pra vidinha", date: today, time: "14:00", vagueTime: false };
const tarefaSemData: CaptureProposalDto = { kind: "tarefa", title: "comprar ração", date: null, time: null, vagueTime: false };

describe("proposalSummary", () => {
  it("descreve o gasto com a categoria e o dia", () => {
    expect(proposalSummary(gasto, today)).toBe("R$ 100,00 em Roupas, hoje");
  });
  it("mostra a descrição só quando acrescenta algo à categoria", () => {
    expect(proposalSummary({ ...gasto, description: "uber", category: "Transporte" }, today)).toBe("R$ 100,00 em Transporte (uber), hoje");
  });
  it("sem categoria usa a descrição entre parênteses", () => {
    expect(proposalSummary({ ...gasto, category: null }, today)).toBe("R$ 100,00 (roupa), hoje");
  });
  it("descreve entrada, entrada a receber e conta", () => {
    expect(proposalSummary(entrada, today)).toBe("entrada de R$ 1.500,00 em Freela, hoje");
    expect(proposalSummary({ ...entrada, status: "a_pagar", date: "2026-11-12" as IsoDate }, today)).toBe("a receber R$ 1.500,00 em Freela, 12/11");
    expect(proposalSummary(conta, today)).toBe("conta de R$ 187,40 em Moradia (luz), vence domingo, 08/11");
    expect(proposalSummary(contaSemData, today)).toBe("conta de R$ 187,40 em Moradia (luz)");
  });
  it("descreve a tarefa com dia e horário, ou sem data", () => {
    expect(proposalSummary(tarefa, today)).toBe("ligar pra vidinha, hoje às 14h");
    expect(proposalSummary({ ...tarefa, date: "2026-11-05" as IsoDate, time: "09:30" }, today)).toBe("ligar pra vidinha, amanhã às 9h30");
    expect(proposalSummary(tarefaSemData, today)).toBe("comprar ração, sem data");
  });
});

describe("proposalNote", () => {
  it("avisa quando a hora não foi dita ou o vencimento falta", () => {
    expect(proposalNote({ ...tarefa, time: null, vagueTime: true })).toBe("Você não disse a hora: fica sem horário por enquanto.");
    expect(proposalNote(contaSemData)).toBe("Qual o vencimento?");
    expect(proposalNote({ ...entrada, status: "a_pagar", date: null })).toBe("Quando você recebe?");
    expect(proposalNote(gasto)).toBeNull();
    expect(proposalNote(tarefa)).toBeNull();
  });
});

describe("canConfirm", () => {
  it("conta e entrada a receber exigem data; o resto confirma", () => {
    expect(canConfirm(contaSemData)).toBe(false);
    expect(canConfirm(conta)).toBe(true);
    expect(canConfirm(gasto)).toBe(true);
    expect(canConfirm(tarefaSemData)).toBe(true);
  });
});

describe("edição", () => {
  it("categorias dependem do tipo", () => {
    expect(categoryOptions(gasto)).toEqual(["Moradia", "Mercado", "Transporte", "Lazer", "Saúde", "Roupas", "Outra"]);
    expect(categoryOptions(entrada)).toEqual(["Salário", "Freela", "Outra"]);
    expect(categoryOptions(tarefa)).toEqual([]);
  });
  it("withCategory troca só a categoria", () => {
    expect(withCategory(gasto, "Lazer")).toMatchObject({ category: "Lazer", amountCents: 10000 });
    expect(withCategory(tarefa, "Lazer")).toEqual(tarefa);
  });
  it("dias passados para o que já aconteceu, futuros para o resto", () => {
    expect(dayOptions(gasto, today).map((o) => o.label)).toEqual(["Hoje", "Ontem", "Anteontem"]);
    expect(dayOptions(tarefa, today).map((o) => o.label)).toEqual(["Hoje", "Amanhã", "Depois de amanhã", "Em 1 semana"]);
    expect(dayOptions(conta, today).find((o) => o.label === "Em 1 semana")?.date).toBe("2026-11-11");
    expect(dayOptions(gasto, today).find((o) => o.label === "Ontem")?.date).toBe("2026-11-03");
  });
  it("withDay troca a data; withTime só vale com data", () => {
    expect(withDay(tarefaSemData, "2026-11-05" as IsoDate)).toMatchObject({ date: "2026-11-05" });
    expect(withTime(tarefa, "16:00")).toMatchObject({ time: "16:00" });
    expect(withTime(tarefa, null)).toMatchObject({ time: null });
    expect(withTime(tarefaSemData, "16:00")).toEqual(tarefaSemData);
  });
  it("horários comuns", () => {
    expect(timeOptions().map((o) => o.label)).toEqual(["9h", "12h", "14h", "16h", "18h", "Sem horário"]);
  });
});

describe("toCreation", () => {
  it("tarefa vira CreateTaskInput sem assumir data nem hora", () => {
    expect(toCreation(tarefa, today)).toEqual({
      kind: "tarefa",
      input: { title: "ligar pra vidinha", type: "tarefa", caseId: null, dueDate: today, dueTime: "14:00", fatal: false },
    });
    expect(toCreation(tarefaSemData, today)).toMatchObject({ kind: "tarefa", input: { dueDate: null, dueTime: null } });
  });
  it("gasto e entrada paga viram lançamentos pagos, no dia da proposta", () => {
    expect(toCreation(gasto, today)).toEqual({
      kind: "lancamento",
      input: { tipo: "gasto", descricao: "roupa", valorCentavos: 10000, categoria: "Roupas", data: today, situacao: "paga", lembreteHora: null },
    });
    expect(toCreation(entrada, today)).toMatchObject({ kind: "lancamento", input: { tipo: "entrada", situacao: "paga" } });
  });
  it("conta vira lançamento a pagar com o horário do lembrete", () => {
    expect(toCreation({ ...conta, time: "09:00" }, today)).toMatchObject({
      kind: "lancamento",
      input: { tipo: "conta", situacao: "a_pagar", data: "2026-11-08", lembreteHora: "09:00" },
    });
  });
  it("sem data em conta não cria (a tela não deixa confirmar)", () => {
    expect(toCreation(contaSemData, today)).toBeNull();
  });
});
