import type { IsoDate } from "@aj/shared";
import { daysBetween, formatShort } from "./dates";
import { spokenTime } from "./mini-tasks";

/** gasto: saída já feita · conta: saída com vencimento · entrada: dinheiro que chega. */
export type LancamentoTipo = "gasto" | "conta" | "entrada";
/** "a_pagar" também vale para entrada ("Vou receber"): ainda não aconteceu. */
export type LancamentoSituacao = "paga" | "a_pagar";

export type Lancamento = {
  id: string;
  tipo: LancamentoTipo;
  descricao: string;
  /** Sempre em centavos inteiros: nunca ponto flutuante para dinheiro. */
  valorCentavos: number;
  categoria: string | null;
  /** Dia do lançamento; para o que está a pagar, o vencimento. */
  data: IsoDate;
  situacao: LancamentoSituacao;
  /** "HH:mm" do lembrete; só para o que está a pagar. */
  lembreteHora: string | null;
  criadoEm: string;
};

export type LancamentoInput = Omit<Lancamento, "id" | "criadoEm">;

export const MAX_CENTAVOS = 99_999_999_999; // R$ 999.999.999,99

/** Valor digitado ("119,90", "1.200", "R$ 100", "12.5") em centavos; null se inválido ou <= 0. */
export function parseValor(text: string): number | null {
  const raw = text.replace(/R\$/gi, "").replace(/\s/g, "");
  if (raw === "" || !/^[\d.,]+$/.test(raw)) return null;
  let normalized: string;
  if (raw.includes(",")) {
    // vírgula decimal; pontos só como milhar
    const [int, dec, ...rest] = raw.split(",");
    if (rest.length > 0 || dec === undefined || !/^\d{1,2}$/.test(dec)) return null;
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(int ?? "")) return null;
    normalized = `${(int ?? "").replace(/\./g, "")}.${dec.padEnd(2, "0")}`;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    normalized = `${raw.replace(/\./g, "")}.00`; // "1.200" é mil e duzentos
  } else if (/^\d+\.\d{1,2}$/.test(raw)) {
    const [int = "", dec = ""] = raw.split(".");
    normalized = `${int}.${dec.padEnd(2, "0")}`;
  } else if (/^\d+$/.test(raw)) {
    normalized = `${raw}.00`;
  } else {
    return null;
  }
  const [int = "0", dec = "00"] = normalized.split(".");
  const cents = Number(int) * 100 + Number(dec);
  return cents > 0 && cents <= MAX_CENTAVOS ? cents : null;
}

/** 123456 → "R$ 1.234,56". Espaço comum, não o inseparável do Intl, para o texto bater em testes e leitores. */
export function formatBRL(centavos: number): string {
  const negative = centavos < 0;
  const abs = Math.abs(Math.round(centavos));
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const dec = String(abs % 100).padStart(2, "0");
  return `${negative ? "−" : ""}R$ ${int},${dec}`;
}

/** "R$ 909" quando não há centavos, "R$ 909,50" quando há: para frases curtas. */
export function formatBRLShort(centavos: number): string {
  return Math.abs(centavos) % 100 === 0 ? formatBRL(centavos).replace(/,00$/, "") : formatBRL(centavos);
}

export type YearMonth = `${number}-${string}`;

export function monthOf(date: IsoDate): YearMonth {
  return date.slice(0, 7) as YearMonth;
}

export function shiftMonth(ym: YearMonth, delta: number): YearMonth {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}` as YearMonth;
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function monthName(ym: YearMonth): string {
  const [, m] = ym.split("-").map(Number) as [number, number];
  const name = MONTHS[m - 1] ?? "";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** "Novembro" no ano corrente, "Novembro de 2027" nos demais. */
export function monthTitle(ym: YearMonth, currentYear: number): string {
  const [y] = ym.split("-").map(Number) as [number];
  return y === currentYear ? monthName(ym) : `${monthName(ym)} de ${y}`;
}

const isSaida = (l: Lancamento) => l.tipo !== "entrada";

export type MonthTotals = { entrou: number; saiu: number; aPagar: number; sobra: number };

/** sobra = entrou − saiu − ainda a pagar. Entrada que ainda vai chegar não conta. */
export function monthTotals(list: readonly Lancamento[], ym: YearMonth): MonthTotals {
  let entrou = 0;
  let saiu = 0;
  let aPagar = 0;
  for (const l of list) {
    if (monthOf(l.data) !== ym) continue;
    if (l.tipo === "entrada") {
      if (l.situacao === "paga") entrou += l.valorCentavos;
    } else if (l.situacao === "paga") {
      saiu += l.valorCentavos;
    } else {
      aPagar += l.valorCentavos;
    }
  }
  return { entrou, saiu, aPagar, sobra: entrou - saiu - aPagar };
}

/** Saídas já pagas por categoria (só as que têm categoria), da maior para a menor. */
export function byCategory(list: readonly Lancamento[], ym: YearMonth): Array<{ categoria: string; total: number }> {
  const sums = new Map<string, number>();
  for (const l of list) {
    if (!isSaida(l) || l.situacao !== "paga" || l.categoria === null || monthOf(l.data) !== ym) continue;
    sums.set(l.categoria, (sums.get(l.categoria) ?? 0) + l.valorCentavos);
  }
  return [...sums.entries()].map(([categoria, total]) => ({ categoria, total })).sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria));
}

const byDue = (a: Lancamento, b: Lancamento) =>
  a.data === b.data ? (a.lembreteHora ?? "99").localeCompare(b.lembreteHora ?? "99") || a.criadoEm.localeCompare(b.criadoEm) : a.data < b.data ? -1 : 1;

/** Saídas ainda a pagar do mês, por vencimento. */
export function billsOfMonth(list: readonly Lancamento[], ym: YearMonth): Lancamento[] {
  return list.filter((l) => isSaida(l) && l.situacao === "a_pagar" && monthOf(l.data) === ym).sort(byDue);
}

/** Entradas ainda por receber no mês. */
export function receivablesOfMonth(list: readonly Lancamento[], ym: YearMonth): Lancamento[] {
  return list.filter((l) => l.tipo === "entrada" && l.situacao === "a_pagar" && monthOf(l.data) === ym).sort(byDue);
}

/** Contas que pedem atenção em Hoje: vencidas e as de hoje. */
export function dueBills(list: readonly Lancamento[], today: IsoDate): { overdue: Lancamento[]; today: Lancamento[] } {
  const open = list.filter((l) => isSaida(l) && l.situacao === "a_pagar");
  return {
    overdue: open.filter((l) => l.data < today).sort(byDue),
    today: open.filter((l) => l.data === today).sort(byDue),
  };
}

export function hasMonthEntries(list: readonly Lancamento[], ym: YearMonth): boolean {
  return list.some((l) => monthOf(l.data) === ym);
}

export type HistoryFilter = "tudo" | "tarefas" | "gastos" | "entradas";

/** O que entra no histórico: só o que já aconteceu (pago ou recebido). */
export function historyEntries(list: readonly Lancamento[], filter: HistoryFilter): Lancamento[] {
  if (filter === "tarefas") return [];
  return list.filter((l) => {
    if (l.situacao !== "paga") return false;
    if (filter === "gastos") return isSaida(l);
    if (filter === "entradas") return l.tipo === "entrada";
    return true;
  });
}

/** Agrupa por dia, do mais recente para o mais antigo; dentro do dia, o último criado primeiro. */
export function groupByDay(list: readonly Lancamento[]): Array<{ day: IsoDate; items: Lancamento[] }> {
  const days = new Map<IsoDate, Lancamento[]>();
  for (const l of list) days.set(l.data, [...(days.get(l.data) ?? []), l]);
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, items]) => ({ day, items: [...items].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)) }));
}

/** Soma assinada de um conjunto: entradas somam, saídas subtraem. */
export function netOf(list: readonly Lancamento[]): number {
  return list.reduce((n, l) => n + (isSaida(l) ? -l.valorCentavos : l.valorCentavos), 0);
}

/** Situação de uma conta a pagar, em frase curta e sem bronca. */
export function dueLabel(l: Lancamento, today: IsoDate): string {
  const diff = daysBetween(today, l.data);
  const day =
    diff === 0 ? "Vence hoje" : diff === 1 ? "Vence amanhã" : diff === -1 ? "Venceu ontem" : diff < 0 ? `Venceu em ${formatShort(l.data)}` : `Vence em ${formatShort(l.data)}`;
  return l.lembreteHora === null ? day : `${day} · lembrete às ${spokenTime(l.lembreteHora)}`;
}

export function isOverdue(l: Lancamento, today: IsoDate): boolean {
  return l.situacao === "a_pagar" && l.data < today;
}

/** Rótulo curto do tipo para o histórico. */
export function tipoLabel(l: Lancamento): string {
  if (l.tipo === "entrada") return "Entrada";
  return l.tipo === "conta" ? "Conta paga" : "Gasto";
}

export const CATEGORIAS_GASTO = ["Moradia", "Mercado", "Transporte", "Lazer", "Saúde", "Outra"] as const;
export const CATEGORIAS_ENTRADA = ["Salário", "Freela", "Outra"] as const;
