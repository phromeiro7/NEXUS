import type { CaptureProposalDto, CreateTaskInput, IsoDate } from "@aj/shared";
import { addDays, daysBetween, formatShort } from "./dates";
import { CATEGORIAS_ENTRADA, CATEGORIAS_GASTO, formatBRL, type LancamentoInput } from "./finance";
import { spokenTime } from "./mini-tasks";

/*
 * A barra de captura do painel lê a frase na API (as mesmas regras do bot) e mostra a proposta aqui.
 * Tudo abaixo é puro: texto da proposta, edição por botões e a conversão para o que será gravado.
 * O texto espelha o do bot ("Anotei: R$ 100,00 em Roupas, hoje.") para os dois canais falarem igual.
 */

type Money = Extract<CaptureProposalDto, { kind: "gasto" | "entrada" | "conta" }>;

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;
const TIME_CHOICES = ["09:00", "12:00", "14:00", "16:00", "18:00"] as const;

const isMoney = (p: CaptureProposalDto): p is Money => p.kind !== "tarefa";
/** Gasto e entrada paga já aconteceram: o dia pode ser hoje ou um dos anteriores. */
const isPast = (p: CaptureProposalDto): boolean => isMoney(p) && p.kind !== "conta" && p.status === "paga";

const weekdayOf = (date: IsoDate): number => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** hoje, amanhã, ontem; até 6 dias à frente "sexta, 06/11"; senão "10/11". */
function dayText(date: IsoDate, today: IsoDate): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  if (diff === -1) return "ontem";
  if (diff >= 2 && diff <= 6) return `${WEEKDAYS[weekdayOf(date)]}, ${formatShort(date)}`;
  return formatShort(date);
}

function whenText(p: CaptureProposalDto, today: IsoDate): string {
  if (p.date === null) return p.kind === "tarefa" ? "sem data" : "";
  const day = dayText(p.date, today);
  return p.time === null ? day : `${day} às ${spokenTime(p.time)}`;
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Frase curta do que foi entendido. */
export function proposalSummary(p: CaptureProposalDto, today: IsoDate): string {
  const when = whenText(p, today);
  if (p.kind === "tarefa") return `${p.title}, ${when}`;
  const money = formatBRL(p.amountCents);
  // A descrição só aparece quando acrescenta algo à categoria ("roupa" já está em "Roupas"; "uber" não está em "Transporte").
  const redundant = p.category !== null && (fold(p.category).includes(fold(p.description)) || fold(p.description).includes(fold(p.category)));
  const named = p.category !== null && !redundant ? ` (${p.description})` : "";
  const what = p.category !== null ? `em ${p.category}${named}` : `(${p.description})`;
  if (p.kind === "gasto") return `${money} ${what}, ${when}`;
  if (p.kind === "entrada") return p.status === "paga" ? `entrada de ${money} ${what}, ${when}` : `a receber ${money} ${what}, ${when}`;
  return p.date === null ? `conta de ${money} ${what}` : `conta de ${money} ${what}, vence ${when}`;
}

/** Aviso complementar: o que a frase não disse. `null` quando não há nada a avisar. */
export function proposalNote(p: CaptureProposalDto): string | null {
  if (p.kind === "tarefa") return p.vagueTime ? "Você não disse a hora: fica sem horário por enquanto." : null;
  if (p.date === null) return p.kind === "conta" ? "Qual o vencimento?" : "Quando você recebe?";
  return null;
}

/** Conta e entrada a receber precisam de data: sem ela a pessoa escolhe em "Editar" antes de confirmar. */
export function canConfirm(p: CaptureProposalDto): boolean {
  return p.kind === "tarefa" || p.status === "paga" || p.date !== null;
}

export function categoryOptions(p: CaptureProposalDto): readonly string[] {
  if (p.kind === "tarefa") return [];
  return p.kind === "entrada" ? CATEGORIAS_ENTRADA : CATEGORIAS_GASTO;
}

export function withCategory(p: CaptureProposalDto, category: string): CaptureProposalDto {
  return isMoney(p) ? { ...p, category } : p;
}

export type DayOption = { label: string; date: IsoDate };

export function dayOptions(p: CaptureProposalDto, today: IsoDate): DayOption[] {
  const rows: Array<[string, number]> = isPast(p)
    ? [["Hoje", 0], ["Ontem", -1], ["Anteontem", -2]]
    : [["Hoje", 0], ["Amanhã", 1], ["Depois de amanhã", 2], ["Em 1 semana", 7]];
  return rows.map(([label, offset]) => ({ label, date: addDays(today, offset) }));
}

export function withDay(p: CaptureProposalDto, date: IsoDate): CaptureProposalDto {
  return { ...p, date };
}

export type TimeOption = { label: string; time: string | null };

export function timeOptions(): TimeOption[] {
  return [...TIME_CHOICES.map((t) => ({ label: spokenTime(t), time: t as string | null })), { label: "Sem horário", time: null }];
}

/** Horário só faz sentido com data (como no cadastro de tarefas): sem data a proposta fica como está. */
export function withTime(p: CaptureProposalDto, time: string | null): CaptureProposalDto {
  return p.date === null ? p : { ...p, time };
}

export type Creation =
  | { kind: "tarefa"; input: CreateTaskInput }
  | { kind: "lancamento"; input: LancamentoInput };

/** O que será gravado ao confirmar; `null` quando ainda falta a data de uma conta ou de uma entrada a receber. */
export function toCreation(p: CaptureProposalDto, today: IsoDate): Creation | null {
  if (!canConfirm(p)) return null;
  if (p.kind === "tarefa") {
    return { kind: "tarefa", input: { title: p.title, type: "tarefa", caseId: null, dueDate: p.date, dueTime: p.time, fatal: false } };
  }
  return {
    kind: "lancamento",
    input: {
      tipo: p.kind,
      descricao: p.description,
      valorCentavos: p.amountCents,
      categoria: p.category,
      data: p.date ?? today,
      situacao: p.status,
      lembreteHora: p.time,
    },
  };
}
