import type { FinanceEntryDto } from "@aj/shared";
import { describe, expect, it } from "vitest";
import { byCreation, toCreateInput, toLancamento } from "./finance-map";

const dto: FinanceEntryDto = {
  id: "0b6f0c4e-1c1e-4e2a-9d3a-5f7f2d9f6a11",
  kind: "conta",
  description: "Aluguel",
  amountCents: 120000,
  category: "Moradia",
  dueDate: "2026-11-05",
  status: "a_pagar",
  reminderTime: "09:00",
  paidAt: null,
  createdAt: "2026-11-04T12:00:00.000Z",
  updatedAt: "2026-11-04T12:00:00.000Z",
};

describe("finance map", () => {
  it("DTO da API vira o modelo das telas", () => {
    expect(toLancamento(dto)).toEqual({
      id: dto.id,
      tipo: "conta",
      descricao: "Aluguel",
      valorCentavos: 120000,
      categoria: "Moradia",
      data: "2026-11-05",
      situacao: "a_pagar",
      lembreteHora: "09:00",
      criadoEm: "2026-11-04T12:00:00.000Z",
    });
  });

  it("ida e volta mantém o id e os campos do POST", () => {
    expect(toCreateInput(toLancamento(dto))).toEqual({
      id: dto.id,
      kind: "conta",
      description: "Aluguel",
      amountCents: 120000,
      category: "Moradia",
      dueDate: "2026-11-05",
      status: "a_pagar",
      reminderTime: "09:00",
    });
  });

  it("ordena do mais antigo ao mais novo, com o id desempatando", () => {
    const a = { ...toLancamento(dto), id: "a", criadoEm: "2026-11-04T12:00:00.000Z" };
    const b = { ...a, id: "b" };
    const c = { ...a, id: "c", criadoEm: "2026-11-03T12:00:00.000Z" };
    expect([b, a, c].sort(byCreation).map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
});
