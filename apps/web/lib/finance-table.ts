import type { IsoDate } from "@nexus/shared";
import { daysBetween, formatShort } from "./dates";
import { monthOf, netOf, type Lancamento, type YearMonth } from "./finance";

/** Filtros e ordenação da tabela de Finanças do painel. Tudo puro: a tela só liga os controles a estas funções. */
export type TableFilter = "tudo" | "gastos" | "entradas" | "contas";
export type SortKey = "data" | "valor" | "descricao";
export type SortDir = "asc" | "desc";
export type Sort = { key: SortKey; dir: SortDir };

/** Minúsculas e sem acentos: a busca "saude" encontra "Saúde". */
const normalizeForComparison = (text: string) => text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Lançamentos do mês que passam pelo filtro de tipo e pela busca (nome ou categoria). */
export function monthRows(
  list: readonly Lancamento[],
  yearMonth: YearMonth,
  options: { filter: TableFilter; query: string },
): Lancamento[] {
  const normalizedQuery = normalizeForComparison(options.query.trim());
  return list.filter((entry) => {
    if (monthOf(entry.data) !== yearMonth) return false;
    if (options.filter === "gastos" && entry.tipo !== "gasto") return false;
    if (options.filter === "entradas" && entry.tipo !== "entrada") return false;
    if (options.filter === "contas" && entry.tipo !== "conta") return false;
    return (
      normalizedQuery === "" ||
      normalizeForComparison(entry.descricao).includes(normalizedQuery) ||
      normalizeForComparison(entry.categoria ?? "").includes(normalizedQuery)
    );
  });
}

/** Ordena sem alterar a lista; empate de data ou valor desempata pelo último criado primeiro. */
export function sortRows(rows: readonly Lancamento[], key: SortKey, dir: SortDir): Lancamento[] {
  const sign = dir === "asc" ? 1 : -1;
  const compareAscending = (first: Lancamento, second: Lancamento): number => {
    if (key === "valor") return first.valorCentavos - second.valorCentavos;
    if (key === "descricao") return first.descricao.localeCompare(second.descricao, "pt-BR");
    return first.data < second.data ? -1 : first.data > second.data ? 1 : 0;
  };
  return [...rows].sort(
    (first, second) => compareAscending(first, second) * sign || second.criadoEm.localeCompare(first.criadoEm),
  );
}

/** Clicar na coluna ativa inverte o sentido; numa coluna nova, começa pelo natural (texto A→Z, data e valor do maior). */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "descricao" ? "asc" : "desc" };
}

/** Soma assinada do que está na tabela: entradas somam, saídas subtraem. */
export const tableTotal = (rows: readonly Lancamento[]): number => netOf(rows);

/** Estado do lançamento em poucas palavras, sem bronca. */
export function situationLabel(entry: Lancamento, today: IsoDate): string {
  if (entry.situacao === "paga") return entry.tipo === "entrada" ? "Recebido" : "Pago";
  const daysFromToday = daysBetween(today, entry.data);
  if (entry.tipo === "entrada") {
    if (daysFromToday === 0) return "A receber hoje";
    if (daysFromToday === 1) return "A receber amanhã";
    return `A receber em ${formatShort(entry.data)}`;
  }
  if (daysFromToday === 0) return "Vence hoje";
  if (daysFromToday === 1) return "Vence amanhã";
  if (daysFromToday === -1) return "Venceu ontem";
  return daysFromToday < 0 ? `Venceu em ${formatShort(entry.data)}` : `Vence em ${formatShort(entry.data)}`;
}

/** Texto do botão de dar baixa; `null` quando já foi pago ou recebido. */
export function rowActionLabel(entry: Lancamento): "Paguei" | "Recebi" | null {
  if (entry.situacao !== "a_pagar") return null;
  return entry.tipo === "entrada" ? "Recebi" : "Paguei";
}
