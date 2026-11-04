import type { IsoDate } from "@aj/shared";
import { daysBetween, formatShort } from "./dates";
import { monthOf, netOf, type Lancamento, type YearMonth } from "./finance";

/** Filtros e ordenação da tabela de Finanças do painel. Tudo puro: a tela só liga os controles a estas funções. */
export type TableFilter = "tudo" | "gastos" | "entradas" | "contas";
export type SortKey = "data" | "valor" | "descricao";
export type SortDir = "asc" | "desc";
export type Sort = { key: SortKey; dir: SortDir };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Lançamentos do mês que passam pelo filtro de tipo e pela busca (nome ou categoria). */
export function monthRows(list: readonly Lancamento[], ym: YearMonth, opts: { filter: TableFilter; query: string }): Lancamento[] {
  const q = fold(opts.query.trim());
  return list.filter((l) => {
    if (monthOf(l.data) !== ym) return false;
    if (opts.filter === "gastos" && l.tipo !== "gasto") return false;
    if (opts.filter === "entradas" && l.tipo !== "entrada") return false;
    if (opts.filter === "contas" && l.tipo !== "conta") return false;
    return q === "" || fold(l.descricao).includes(q) || fold(l.categoria ?? "").includes(q);
  });
}

/** Ordena sem alterar a lista; empate de data ou valor desempata pelo último criado primeiro. */
export function sortRows(rows: readonly Lancamento[], key: SortKey, dir: SortDir): Lancamento[] {
  const sign = dir === "asc" ? 1 : -1;
  const compare = (a: Lancamento, b: Lancamento): number => {
    if (key === "valor") return a.valorCentavos - b.valorCentavos;
    if (key === "descricao") return a.descricao.localeCompare(b.descricao, "pt-BR");
    return a.data < b.data ? -1 : a.data > b.data ? 1 : 0;
  };
  return [...rows].sort((a, b) => compare(a, b) * sign || b.criadoEm.localeCompare(a.criadoEm));
}

/** Clicar na coluna ativa inverte o sentido; numa coluna nova, começa pelo natural (texto A→Z, data e valor do maior). */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "descricao" ? "asc" : "desc" };
}

/** Soma assinada do que está na tabela: entradas somam, saídas subtraem. */
export const tableTotal = (rows: readonly Lancamento[]): number => netOf(rows);

/** Estado do lançamento em poucas palavras, sem bronca. */
export function situationLabel(l: Lancamento, today: IsoDate): string {
  if (l.situacao === "paga") return l.tipo === "entrada" ? "Recebido" : "Pago";
  const diff = daysBetween(today, l.data);
  if (l.tipo === "entrada") return diff === 0 ? "A receber hoje" : diff === 1 ? "A receber amanhã" : `A receber em ${formatShort(l.data)}`;
  if (diff === 0) return "Vence hoje";
  if (diff === 1) return "Vence amanhã";
  if (diff === -1) return "Venceu ontem";
  return diff < 0 ? `Venceu em ${formatShort(l.data)}` : `Vence em ${formatShort(l.data)}`;
}

/** Texto do botão de dar baixa; `null` quando já foi pago ou recebido. */
export function rowActionLabel(l: Lancamento): "Paguei" | "Recebi" | null {
  if (l.situacao !== "a_pagar") return null;
  return l.tipo === "entrada" ? "Recebi" : "Paguei";
}
