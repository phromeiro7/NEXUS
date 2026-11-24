import type { IsoDate } from "@nexus/shared";
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

/** O que a tela preenche; id e data de criação são gerados ao salvar. */
export type LancamentoInput = Omit<Lancamento, "id" | "criadoEm">;

/** Maior valor aceito (o mesmo limite da API). */
export const MAX_CENTAVOS = 99_999_999_999; // R$ 999.999.999,99

const CENTS_PER_REAL = 100;
const MONTHS_PER_YEAR = 12;

/** Valor digitado ("119,90", "1.200", "R$ 100", "12.5") em centavos; null se inválido ou <= 0. */
export function parseValor(text: string): number | null {
  const raw = text.replace(/R\$/gi, "").replace(/\s/g, "");
  if (raw === "" || !/^[\d.,]+$/.test(raw)) return null;
  let normalized: string;
  if (raw.includes(",")) {
    // vírgula decimal; pontos só como milhar
    const [integerPart, decimalPart, ...extraParts] = raw.split(",");
    if (extraParts.length > 0 || decimalPart === undefined || !/^\d{1,2}$/.test(decimalPart)) return null;
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(integerPart ?? "")) return null;
    normalized = `${(integerPart ?? "").replace(/\./g, "")}.${decimalPart.padEnd(2, "0")}`;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    normalized = `${raw.replace(/\./g, "")}.00`; // "1.200" é mil e duzentos
  } else if (/^\d+\.\d{1,2}$/.test(raw)) {
    const [integerPart = "", decimalPart = ""] = raw.split("."); // "12.5" é doze e cinquenta
    normalized = `${integerPart}.${decimalPart.padEnd(2, "0")}`;
  } else if (/^\d+$/.test(raw)) {
    normalized = `${raw}.00`;
  } else {
    return null;
  }
  // Monta os centavos com inteiros (reais × 100 + centavos) para não passar por ponto flutuante.
  const [reais = "0", centavos = "00"] = normalized.split(".");
  const cents = Number(reais) * CENTS_PER_REAL + Number(centavos);
  return cents > 0 && cents <= MAX_CENTAVOS ? cents : null;
}

/** 123456 → "R$ 1.234,56". Espaço comum, não o inseparável do Intl, para o texto bater em testes e leitores. */
export function formatBRL(centavos: number): string {
  const isNegative = centavos < 0;
  const absoluteCents = Math.abs(Math.round(centavos));
  // Ponto a cada três dígitos dos reais: 1234 → "1.234".
  const reais = String(Math.floor(absoluteCents / CENTS_PER_REAL)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const cents = String(absoluteCents % CENTS_PER_REAL).padStart(2, "0");
  return `${isNegative ? "−" : ""}R$ ${reais},${cents}`;
}

/** "R$ 909" quando não há centavos, "R$ 909,50" quando há: para frases curtas. */
export function formatBRLShort(centavos: number): string {
  return Math.abs(centavos) % CENTS_PER_REAL === 0 ? formatBRL(centavos).replace(/,00$/, "") : formatBRL(centavos);
}

/** Mês no formato "YYYY-MM". */
export type YearMonth = `${number}-${string}`;

/** "2026-11-24" → "2026-11". */
export function monthOf(date: IsoDate): YearMonth {
  return date.slice(0, 7) as YearMonth;
}

/** Avança (ou volta, com `delta` negativo) meses, atravessando a virada do ano. */
export function shiftMonth(yearMonth: YearMonth, delta: number): YearMonth {
  const [year, month] = yearMonth.split("-").map(Number) as [number, number];
  // Conta em meses desde o ano zero (janeiro = 0) para a divisão resolver a virada do ano.
  const monthIndex = year * MONTHS_PER_YEAR + (month - 1) + delta;
  const shiftedYear = Math.floor(monthIndex / MONTHS_PER_YEAR);
  const shiftedMonth = (monthIndex % MONTHS_PER_YEAR) + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, "0")}` as YearMonth;
}

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Nome do mês com inicial maiúscula ("Novembro"). */
export function monthName(yearMonth: YearMonth): string {
  const [, month] = yearMonth.split("-").map(Number) as [number, number];
  const name = MONTH_NAMES[month - 1] ?? "";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** "Novembro" no ano corrente, "Novembro de 2027" nos demais. */
export function monthTitle(yearMonth: YearMonth, currentYear: number): string {
  const [year] = yearMonth.split("-").map(Number) as [number];
  return year === currentYear ? monthName(yearMonth) : `${monthName(yearMonth)} de ${year}`;
}

/** Gasto e conta tiram dinheiro; só entrada traz. */
const isSaida = (entry: Lancamento) => entry.tipo !== "entrada";

/** Totais do mês, em centavos. */
export type MonthTotals = { entrou: number; saiu: number; aPagar: number; sobra: number };

/** sobra = entrou − saiu − ainda a pagar. Entrada que ainda vai chegar não conta. */
export function monthTotals(list: readonly Lancamento[], yearMonth: YearMonth): MonthTotals {
  let entrou = 0;
  let saiu = 0;
  let aPagar = 0;
  for (const entry of list) {
    if (monthOf(entry.data) !== yearMonth) continue;
    if (entry.tipo === "entrada") {
      if (entry.situacao === "paga") entrou += entry.valorCentavos;
    } else if (entry.situacao === "paga") {
      saiu += entry.valorCentavos;
    } else {
      aPagar += entry.valorCentavos;
    }
  }
  return { entrou, saiu, aPagar, sobra: entrou - saiu - aPagar };
}

/** Saídas já pagas por categoria (só as que têm categoria), da maior para a menor. */
export function byCategory(list: readonly Lancamento[], yearMonth: YearMonth): Array<{ categoria: string; total: number }> {
  const totalByCategory = new Map<string, number>();
  for (const entry of list) {
    if (!isSaida(entry) || entry.situacao !== "paga" || entry.categoria === null || monthOf(entry.data) !== yearMonth) continue;
    totalByCategory.set(entry.categoria, (totalByCategory.get(entry.categoria) ?? 0) + entry.valorCentavos);
  }
  return [...totalByCategory.entries()]
    .map(([categoria, total]) => ({ categoria, total }))
    .sort((first, second) => second.total - first.total || first.categoria.localeCompare(second.categoria));
}

/** Ordena sem lembrete depois de qualquer "HH:mm" do mesmo dia. */
const NO_REMINDER_SORT_KEY = "99";

/** Por vencimento; no mesmo dia, pela hora do lembrete e depois pela ordem de criação. */
const byDue = (first: Lancamento, second: Lancamento) => {
  if (first.data !== second.data) return first.data < second.data ? -1 : 1;
  return (
    (first.lembreteHora ?? NO_REMINDER_SORT_KEY).localeCompare(second.lembreteHora ?? NO_REMINDER_SORT_KEY) ||
    first.criadoEm.localeCompare(second.criadoEm)
  );
};

/** Saídas ainda a pagar do mês, por vencimento. */
export function billsOfMonth(list: readonly Lancamento[], yearMonth: YearMonth): Lancamento[] {
  return list
    .filter((entry) => isSaida(entry) && entry.situacao === "a_pagar" && monthOf(entry.data) === yearMonth)
    .sort(byDue);
}

/** Entradas ainda por receber no mês. */
export function receivablesOfMonth(list: readonly Lancamento[], yearMonth: YearMonth): Lancamento[] {
  return list
    .filter((entry) => entry.tipo === "entrada" && entry.situacao === "a_pagar" && monthOf(entry.data) === yearMonth)
    .sort(byDue);
}

/** Contas que pedem atenção em Hoje: vencidas e as de hoje. */
export function dueBills(list: readonly Lancamento[], today: IsoDate): { overdue: Lancamento[]; today: Lancamento[] } {
  const openBills = list.filter((entry) => isSaida(entry) && entry.situacao === "a_pagar");
  return {
    overdue: openBills.filter((entry) => entry.data < today).sort(byDue),
    today: openBills.filter((entry) => entry.data === today).sort(byDue),
  };
}

/** Há algum lançamento no mês? */
export function hasMonthEntries(list: readonly Lancamento[], yearMonth: YearMonth): boolean {
  return list.some((entry) => monthOf(entry.data) === yearMonth);
}

/** Filtros do histórico; "tarefas" não mostra lançamento nenhum. */
export type HistoryFilter = "tudo" | "tarefas" | "gastos" | "entradas";

/** O que entra no histórico: só o que já aconteceu (pago ou recebido). */
export function historyEntries(list: readonly Lancamento[], filter: HistoryFilter): Lancamento[] {
  if (filter === "tarefas") return [];
  return list.filter((entry) => {
    if (entry.situacao !== "paga") return false;
    if (filter === "gastos") return isSaida(entry);
    if (filter === "entradas") return entry.tipo === "entrada";
    return true;
  });
}

/** Agrupa por dia, do mais recente para o mais antigo; dentro do dia, o último criado primeiro. */
export function groupByDay(list: readonly Lancamento[]): Array<{ day: IsoDate; items: Lancamento[] }> {
  const entriesByDay = new Map<IsoDate, Lancamento[]>();
  for (const entry of list) entriesByDay.set(entry.data, [...(entriesByDay.get(entry.data) ?? []), entry]);
  return [...entriesByDay.entries()]
    .sort(([firstDay], [secondDay]) => (firstDay < secondDay ? 1 : firstDay > secondDay ? -1 : 0))
    .map(([day, items]) => ({
      day,
      items: [...items].sort((first, second) => second.criadoEm.localeCompare(first.criadoEm)),
    }));
}

/** Soma assinada de um conjunto: entradas somam, saídas subtraem. */
export function netOf(list: readonly Lancamento[]): number {
  return list.reduce((total, entry) => total + (isSaida(entry) ? -entry.valorCentavos : entry.valorCentavos), 0);
}

/** Situação de uma conta a pagar, em frase curta e sem bronca. */
export function dueLabel(entry: Lancamento, today: IsoDate): string {
  const dueText = dueDayText(entry.data, today);
  return entry.lembreteHora === null ? dueText : `${dueText} · lembrete às ${spokenTime(entry.lembreteHora)}`;
}

function dueDayText(dueDate: IsoDate, today: IsoDate): string {
  const daysFromToday = daysBetween(today, dueDate);
  if (daysFromToday === 0) return "Vence hoje";
  if (daysFromToday === 1) return "Vence amanhã";
  if (daysFromToday === -1) return "Venceu ontem";
  return daysFromToday < 0 ? `Venceu em ${formatShort(dueDate)}` : `Vence em ${formatShort(dueDate)}`;
}

/** Ainda a pagar (ou a receber) e com a data já passada. */
export function isOverdue(entry: Lancamento, today: IsoDate): boolean {
  return entry.situacao === "a_pagar" && entry.data < today;
}

/** Rótulo curto do tipo para o histórico. */
export function tipoLabel(entry: Lancamento): string {
  if (entry.tipo === "entrada") return "Entrada";
  return entry.tipo === "conta" ? "Conta paga" : "Gasto";
}

/** Categorias oferecidas nas telas, por tipo de lançamento. */
export const CATEGORIAS_GASTO = ["Moradia", "Mercado", "Transporte", "Lazer", "Saúde", "Roupas", "Outra"] as const;
export const CATEGORIAS_ENTRADA = ["Salário", "Freela", "Outra"] as const;
