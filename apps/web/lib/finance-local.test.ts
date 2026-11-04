import { beforeEach, describe, expect, it } from "vitest";
import type { Lancamento } from "./finance";
import { clearLocalLancamentos, isLancamento, readLocalLancamentos } from "./finance-local";

const ok: Lancamento = {
  id: "0b6f0c4e-1c1e-4e2a-9d3a-5f7f2d9f6a11",
  tipo: "conta",
  descricao: "Internet",
  valorCentavos: 11990,
  categoria: "Moradia",
  data: "2026-11-04",
  situacao: "a_pagar",
  lembreteHora: "09:00",
  criadoEm: "2026-11-04T12:00:00.000Z",
};

beforeEach(() => localStorage.clear());

describe("lançamentos antigos deste aparelho", () => {
  it("lê só o que a API também aceitaria e ignora o resto", () => {
    localStorage.setItem(
      "nexus:financas:v1:u1",
      JSON.stringify([
        ok,
        { ...ok, id: "l-abc" },
        { ...ok, valorCentavos: 10.5 },
        { ...ok, tipo: "gasto", situacao: "a_pagar" },
        { ...ok, descricao: "" },
        "lixo",
      ]),
    );
    expect(readLocalLancamentos("u1")).toEqual([ok]);
  });

  it("dado corrompido, ausente ou de outro usuário vira lista vazia", () => {
    expect(readLocalLancamentos("u1")).toEqual([]);
    localStorage.setItem("nexus:financas:v1:u1", "{nope");
    expect(readLocalLancamentos("u1")).toEqual([]);
    localStorage.setItem("nexus:financas:v1:u2", JSON.stringify([ok]));
    expect(readLocalLancamentos("u1")).toEqual([]);
  });

  it("clear remove só a chave do usuário", () => {
    localStorage.setItem("nexus:financas:v1:u1", JSON.stringify([ok]));
    localStorage.setItem("nexus:financas:v1:u2", JSON.stringify([ok]));
    clearLocalLancamentos("u1");
    expect(readLocalLancamentos("u1")).toEqual([]);
    expect(readLocalLancamentos("u2")).toEqual([ok]);
  });

  it("isLancamento rejeita o que não é objeto", () => {
    expect(isLancamento(null)).toBe(false);
    expect(isLancamento(3)).toBe(false);
  });
});
