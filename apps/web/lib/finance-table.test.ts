import type { IsoDate } from "@nexus/shared";
import { describe, expect, it } from "vitest";
import type { Lancamento } from "./finance";
import { monthRows, nextSort, rowActionLabel, situationLabel, sortRows, tableTotal } from "./finance-table";

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
const mercado = l({ descricao: "Mercado", categoria: "Mercado", valorCentavos: 8640 });
const almoco = l({ descricao: "Almoço", categoria: "Lazer", valorCentavos: 4200, data: "2026-11-03" as IsoDate });
const freela = l({ tipo: "entrada", descricao: "Freela: site da clínica", categoria: "Freela", valorCentavos: 150000, data: "2026-11-03" as IsoDate });
const aluguel = l({ tipo: "conta", descricao: "Aluguel", categoria: "Moradia", valorCentavos: 120000, data: "2026-11-05" as IsoDate, situacao: "a_pagar" });
const luz = l({ tipo: "conta", descricao: "Luz", categoria: "Moradia", valorCentavos: 18740, data: "2026-11-02" as IsoDate, situacao: "a_pagar" });
const outubro = l({ descricao: "Cinema", data: "2026-10-30" as IsoDate });
const all = [mercado, almoco, freela, aluguel, luz, outubro];

describe("monthRows", () => {
  it("só o mês pedido", () => {
    expect(monthRows(all, "2026-11", { filter: "tudo", query: "" }).map((r) => r.descricao)).not.toContain("Cinema");
    expect(monthRows(all, "2026-10", { filter: "tudo", query: "" }).map((r) => r.descricao)).toEqual(["Cinema"]);
  });
  it("filtra por tipo", () => {
    const names = (filter: "gastos" | "entradas" | "contas") => monthRows(all, "2026-11", { filter, query: "" }).map((r) => r.descricao).sort();
    expect(names("gastos")).toEqual(["Almoço", "Mercado"]);
    expect(names("entradas")).toEqual(["Freela: site da clínica"]);
    expect(names("contas")).toEqual(["Aluguel", "Luz"]);
  });
  it("busca por nome ou categoria, sem acento nem caixa", () => {
    const q = (query: string) => monthRows(all, "2026-11", { filter: "tudo", query }).map((r) => r.descricao).sort();
    expect(q("almoco")).toEqual(["Almoço"]);
    expect(q("MORADIA")).toEqual(["Aluguel", "Luz"]);
    expect(q("  ")).toHaveLength(5);
    expect(q("nada disso")).toEqual([]);
  });
});

describe("sortRows", () => {
  const rows = monthRows(all, "2026-11", { filter: "tudo", query: "" });
  it("por data, do mais recente ao mais antigo, e desempata pelo último criado", () => {
    const sorted = sortRows(rows, "data", "desc").map((r) => r.descricao);
    expect(sorted[0]).toBe("Aluguel");
    expect(sorted.at(-1)).toBe("Luz");
  });
  it("por valor e por descrição, nos dois sentidos", () => {
    expect(sortRows(rows, "valor", "desc")[0]!.descricao).toBe("Freela: site da clínica");
    expect(sortRows(rows, "valor", "asc")[0]!.descricao).toBe("Almoço");
    expect(sortRows(rows, "descricao", "asc").map((r) => r.descricao).slice(0, 2)).toEqual(["Almoço", "Aluguel"]);
  });
  it("não muda a lista original", () => {
    const copy = [...rows];
    sortRows(rows, "valor", "asc");
    expect(rows).toEqual(copy);
  });
});

describe("nextSort", () => {
  it("clicar na coluna ativa inverte; numa nova, começa pelo sentido natural", () => {
    expect(nextSort({ key: "data", dir: "desc" }, "data")).toEqual({ key: "data", dir: "asc" });
    expect(nextSort({ key: "data", dir: "desc" }, "valor")).toEqual({ key: "valor", dir: "desc" });
    expect(nextSort({ key: "data", dir: "desc" }, "descricao")).toEqual({ key: "descricao", dir: "asc" });
  });
});

describe("tableTotal", () => {
  it("entradas somam e saídas subtraem, só do que está na tabela", () => {
    expect(tableTotal([mercado, freela])).toBe(150000 - 8640);
    expect(tableTotal([])).toBe(0);
  });
});

describe("situationLabel", () => {
  it("diz o estado em poucas palavras", () => {
    expect(situationLabel(mercado, today)).toBe("Pago");
    expect(situationLabel(freela, today)).toBe("Recebido");
    expect(situationLabel(aluguel, today)).toBe("Vence amanhã");
    expect(situationLabel(luz, today)).toBe("Venceu em 02/11");
    expect(situationLabel({ ...aluguel, data: today }, today)).toBe("Vence hoje");
    expect(situationLabel({ ...aluguel, data: "2026-11-20" as IsoDate }, today)).toBe("Vence em 20/11");
    expect(situationLabel({ ...freela, situacao: "a_pagar", data: "2026-11-10" as IsoDate }, today)).toBe("A receber em 10/11");
  });
});

describe("rowActionLabel", () => {
  it("só o que está a pagar tem ação de pagar", () => {
    expect(rowActionLabel(aluguel)).toBe("Paguei");
    expect(rowActionLabel({ ...freela, situacao: "a_pagar" })).toBe("Recebi");
    expect(rowActionLabel(mercado)).toBeNull();
  });
});
