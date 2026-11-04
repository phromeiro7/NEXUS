import type { IsoDate } from "@aj/shared";
import { describe, expect, it } from "vitest";
import {
  billsOfMonth,
  byCategory,
  dueBills,
  dueLabel,
  formatBRL,
  formatBRLShort,
  groupByDay,
  hasMonthEntries,
  historyEntries,
  monthOf,
  monthTitle,
  monthTotals,
  netOf,
  parseValor,
  receivablesOfMonth,
  shiftMonth,
  type Lancamento,
} from "./finance";

let n = 0;
function l(over: Partial<Lancamento> = {}): Lancamento {
  n += 1;
  return {
    id: `l${n}`,
    tipo: "gasto",
    descricao: "Item",
    valorCentavos: 1000,
    categoria: null,
    data: "2026-11-04" as IsoDate,
    situacao: "paga",
    lembreteHora: null,
    criadoEm: `2026-11-04T10:00:${String(n % 60).padStart(2, "0")}Z`,
    ...over,
  };
}

const today = "2026-11-04" as IsoDate;

describe("parseValor", () => {
  it("entende vírgula decimal, milhar e inteiro", () => {
    expect(parseValor("119,90")).toBe(11990);
    expect(parseValor("1.200")).toBe(120000);
    expect(parseValor("1.200,5")).toBe(120050);
    expect(parseValor("100")).toBe(10000);
    expect(parseValor("R$ 42,00")).toBe(4200);
    expect(parseValor("0,50")).toBe(50);
    expect(parseValor("12.5")).toBe(1250);
    expect(parseValor("1.234.567,89")).toBe(123456789);
  });
  it("recusa vazio, zero, negativo, texto e formatos ambíguos", () => {
    for (const bad of ["", " ", "0", "0,00", "-5", "abc", "1,234", "1,2,3", "1.2.3", "12,345", "1e5", "99999999999999"]) {
      expect(parseValor(bad), bad).toBeNull();
    }
  });
});

describe("formatBRL", () => {
  it("usa milhar com ponto e vírgula decimal", () => {
    expect(formatBRL(123456)).toBe("R$ 1.234,56");
    expect(formatBRL(5)).toBe("R$ 0,05");
    expect(formatBRL(100000000)).toBe("R$ 1.000.000,00");
  });
  it("mostra sinal negativo e a forma curta sem centavos", () => {
    expect(formatBRL(-9050)).toBe("−R$ 90,50");
    expect(formatBRLShort(90900)).toBe("R$ 909");
    expect(formatBRLShort(90950)).toBe("R$ 909,50");
  });
});

describe("meses", () => {
  it("anda entre meses e vira o ano", () => {
    expect(shiftMonth("2026-11", 1)).toBe("2026-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthOf("2026-11-04" as IsoDate)).toBe("2026-11");
  });
  it("nomeia o mês e acrescenta o ano fora do corrente", () => {
    expect(monthTitle("2026-11", 2026)).toBe("Novembro");
    expect(monthTitle("2027-03", 2026)).toBe("Março de 2027");
  });
});

describe("monthTotals", () => {
  const list = [
    l({ tipo: "entrada", valorCentavos: 500000 }),
    l({ tipo: "entrada", valorCentavos: 80000, situacao: "a_pagar" }), // ainda não chegou: não conta
    l({ tipo: "gasto", valorCentavos: 20000 }),
    l({ tipo: "conta", valorCentavos: 30000, situacao: "paga" }),
    l({ tipo: "conta", valorCentavos: 120000, situacao: "a_pagar" }),
    l({ tipo: "gasto", valorCentavos: 99900, data: "2026-10-31" as IsoDate }), // outro mês
  ];
  it("sobra = entrou − saiu − ainda a pagar", () => {
    expect(monthTotals(list, "2026-11")).toEqual({ entrou: 500000, saiu: 50000, aPagar: 120000, sobra: 330000 });
  });
  it("mês sem lançamentos zera tudo; sobra pode ser negativa", () => {
    expect(monthTotals(list, "2026-09")).toEqual({ entrou: 0, saiu: 0, aPagar: 0, sobra: 0 });
    expect(monthTotals([l({ tipo: "conta", situacao: "a_pagar", valorCentavos: 5000 })], "2026-11").sobra).toBe(-5000);
  });
  it("nunca soma ponto flutuante: valores inteiros", () => {
    const t = monthTotals([l({ valorCentavos: 10 }), l({ valorCentavos: 20 })], "2026-11");
    expect(t.saiu).toBe(30);
  });
  it("detecta mês com lançamentos", () => {
    expect(hasMonthEntries(list, "2026-11")).toBe(true);
    expect(hasMonthEntries(list, "2026-08")).toBe(false);
  });
});

describe("byCategory", () => {
  it("soma só saídas pagas com categoria, da maior para a menor", () => {
    const list = [
      l({ categoria: "Mercado", valorCentavos: 6000 }),
      l({ categoria: "Mercado", valorCentavos: 4000 }),
      l({ categoria: "Lazer", valorCentavos: 15000 }),
      l({ categoria: null, valorCentavos: 99999 }),
      l({ categoria: "Moradia", valorCentavos: 120000, tipo: "conta", situacao: "a_pagar" }),
      l({ tipo: "entrada", categoria: "Freela", valorCentavos: 70000 }),
    ];
    expect(byCategory(list, "2026-11")).toEqual([
      { categoria: "Lazer", total: 15000 },
      { categoria: "Mercado", total: 10000 },
    ]);
  });
});

describe("contas", () => {
  const list = [
    l({ tipo: "conta", situacao: "a_pagar", data: "2026-11-10" as IsoDate, descricao: "Plano" }),
    l({ tipo: "conta", situacao: "a_pagar", data: "2026-11-04" as IsoDate, lembreteHora: "14:00", descricao: "Cartão" }),
    l({ tipo: "conta", situacao: "a_pagar", data: "2026-11-04" as IsoDate, lembreteHora: "09:00", descricao: "Internet" }),
    l({ tipo: "conta", situacao: "a_pagar", data: "2026-11-01" as IsoDate, descricao: "Luz" }),
    l({ tipo: "conta", situacao: "paga", data: "2026-11-02" as IsoDate }),
    l({ tipo: "entrada", situacao: "a_pagar", data: "2026-11-20" as IsoDate, descricao: "Freela" }),
  ];
  it("contas do mês por vencimento e hora, sem entradas", () => {
    expect(billsOfMonth(list, "2026-11").map((b) => b.descricao)).toEqual(["Luz", "Internet", "Cartão", "Plano"]);
    expect(receivablesOfMonth(list, "2026-11").map((b) => b.descricao)).toEqual(["Freela"]);
  });
  it("separa vencidas e de hoje", () => {
    const d = dueBills(list, today);
    expect(d.overdue.map((b) => b.descricao)).toEqual(["Luz"]);
    expect(d.today.map((b) => b.descricao)).toEqual(["Internet", "Cartão"]);
  });
  it("descreve o vencimento sem bronca", () => {
    expect(dueLabel(l({ data: today, lembreteHora: "09:00" }), today)).toBe("Vence hoje · lembrete às 9h");
    expect(dueLabel(l({ data: "2026-11-05" as IsoDate }), today)).toBe("Vence amanhã");
    expect(dueLabel(l({ data: "2026-11-03" as IsoDate }), today)).toBe("Venceu ontem");
    expect(dueLabel(l({ data: "2026-10-30" as IsoDate }), today)).toBe("Venceu em 30/10");
    expect(dueLabel(l({ data: "2026-11-10" as IsoDate }), today)).toBe("Vence em 10/11");
  });
});

describe("histórico", () => {
  const list = [
    l({ tipo: "gasto" }),
    l({ tipo: "conta", situacao: "paga" }),
    l({ tipo: "entrada", valorCentavos: 5000 }),
    l({ tipo: "conta", situacao: "a_pagar" }),
  ];
  it("só entra o que já aconteceu e os filtros separam saídas de entradas", () => {
    expect(historyEntries(list, "tudo")).toHaveLength(3);
    expect(historyEntries(list, "gastos").map((x) => x.tipo)).toEqual(["gasto", "conta"]);
    expect(historyEntries(list, "entradas").map((x) => x.tipo)).toEqual(["entrada"]);
    expect(historyEntries(list, "tarefas")).toEqual([]);
  });
  it("agrupa por dia, o mais recente primeiro, e o último criado no topo", () => {
    const a = l({ data: "2026-11-03" as IsoDate, criadoEm: "2026-11-03T08:00:00Z", descricao: "a" });
    const b = l({ data: "2026-11-04" as IsoDate, criadoEm: "2026-11-04T08:00:00Z", descricao: "b" });
    const c = l({ data: "2026-11-04" as IsoDate, criadoEm: "2026-11-04T09:00:00Z", descricao: "c" });
    const groups = groupByDay([a, b, c]);
    expect(groups.map((g) => g.day)).toEqual(["2026-11-04", "2026-11-03"]);
    expect(groups[0]?.items.map((i) => i.descricao)).toEqual(["c", "b"]);
  });
  it("soma assinada: entradas somam, saídas subtraem", () => {
    expect(netOf([l({ valorCentavos: 3000 }), l({ tipo: "entrada", valorCentavos: 10000 })])).toBe(7000);
  });
});
