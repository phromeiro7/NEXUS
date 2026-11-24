import type { CaptureProposalDto, CreateTaskInput, IsoDate } from "@nexus/shared";
import { addDays, daysBetween, formatShort } from "./dates";
import { CATEGORIAS_ENTRADA, CATEGORIAS_GASTO, formatBRL, type LancamentoInput } from "./finance";
import { spokenTime } from "./mini-tasks";
import { normalizeForComparison } from "./text";

/*
 * A barra de captura do painel lê a frase na API (as mesmas regras do bot) e mostra a proposta aqui.
 * Tudo abaixo é puro: texto da proposta, edição por botões e a conversão para o que será gravado.
 * O texto espelha o do bot ("Anotei: R$ 100,00 em Roupas, hoje.") para os dois canais falarem igual.
 */

type MoneyProposal = Extract<CaptureProposalDto, { kind: "gasto" | "entrada" | "conta" }>;

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;
/** Horários oferecidos como botões ao editar a proposta. */
const TIME_CHOICES = ["09:00", "12:00", "14:00", "16:00", "18:00"] as const;
/** Até quantos dias à frente o dia da semana ajuda ("sexta, 06/11"); depois disso, só a data. */
const MAX_DAYS_AHEAD_WITH_WEEKDAY = 6;

const isMoney = (proposal: CaptureProposalDto): proposal is MoneyProposal => proposal.kind !== "tarefa";
/** Gasto e entrada paga já aconteceram: o dia pode ser hoje ou um dos anteriores. */
const isPast = (proposal: CaptureProposalDto): boolean =>
  isMoney(proposal) && proposal.kind !== "conta" && proposal.status === "paga";

/** Dia da semana (domingo = 0), calculado em UTC para não depender do fuso do navegador. */
const weekdayOf = (date: IsoDate): number => {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

/** hoje, amanhã, ontem; até 6 dias à frente "sexta, 06/11"; senão "10/11". */
function dayText(date: IsoDate, today: IsoDate): string {
  const daysFromToday = daysBetween(today, date);
  if (daysFromToday === 0) return "hoje";
  if (daysFromToday === 1) return "amanhã";
  if (daysFromToday === -1) return "ontem";
  if (daysFromToday >= 2 && daysFromToday <= MAX_DAYS_AHEAD_WITH_WEEKDAY) return `${WEEKDAYS[weekdayOf(date)]}, ${formatShort(date)}`;
  return formatShort(date);
}

function whenText(proposal: CaptureProposalDto, today: IsoDate): string {
  if (proposal.date === null) return proposal.kind === "tarefa" ? "sem data" : "";
  const day = dayText(proposal.date, today);
  return proposal.time === null ? day : `${day} às ${spokenTime(proposal.time)}`;
}

/** Frase curta do que foi entendido. */
export function proposalSummary(proposal: CaptureProposalDto, today: IsoDate): string {
  const when = whenText(proposal, today);
  if (proposal.kind === "tarefa") return `${proposal.title}, ${when}`;
  const amount = formatBRL(proposal.amountCents);
  const { category, description } = proposal;
  // A descrição só aparece quando acrescenta algo à categoria ("roupa" já está em "Roupas"; "uber" não está em "Transporte").
  const isDescriptionRedundant =
    category !== null &&
    (normalizeForComparison(category).includes(normalizeForComparison(description)) ||
      normalizeForComparison(description).includes(normalizeForComparison(category)));
  const descriptionSuffix = category !== null && !isDescriptionRedundant ? ` (${description})` : "";
  const what = category !== null ? `em ${category}${descriptionSuffix}` : `(${description})`;
  if (proposal.kind === "gasto") return `${amount} ${what}, ${when}`;
  if (proposal.kind === "entrada") {
    return proposal.status === "paga" ? `entrada de ${amount} ${what}, ${when}` : `a receber ${amount} ${what}, ${when}`;
  }
  return proposal.date === null ? `conta de ${amount} ${what}` : `conta de ${amount} ${what}, vence ${when}`;
}

/** Aviso complementar: o que a frase não disse. `null` quando não há nada a avisar. */
export function proposalNote(proposal: CaptureProposalDto): string | null {
  if (proposal.kind === "tarefa") return proposal.vagueTime ? "Você não disse a hora: fica sem horário por enquanto." : null;
  if (proposal.date === null) return proposal.kind === "conta" ? "Qual o vencimento?" : "Quando você recebe?";
  return null;
}

/** Conta e entrada a receber precisam de data: sem ela a pessoa escolhe em "Editar" antes de confirmar. */
export function canConfirm(proposal: CaptureProposalDto): boolean {
  return proposal.kind === "tarefa" || proposal.status === "paga" || proposal.date !== null;
}

/** Categorias que a pessoa pode escolher; tarefa não tem categoria. */
export function categoryOptions(proposal: CaptureProposalDto): readonly string[] {
  if (proposal.kind === "tarefa") return [];
  return proposal.kind === "entrada" ? CATEGORIAS_ENTRADA : CATEGORIAS_GASTO;
}

/** Troca a categoria de um lançamento; tarefa volta inalterada. */
export function withCategory(proposal: CaptureProposalDto, category: string): CaptureProposalDto {
  return isMoney(proposal) ? { ...proposal, category } : proposal;
}

export type DayOption = { label: string; date: IsoDate };

/** Botões de dia: para o que já aconteceu, hoje e dias anteriores; para o resto, hoje e dias à frente. */
export function dayOptions(proposal: CaptureProposalDto, today: IsoDate): DayOption[] {
  const labelsAndOffsets: Array<[string, number]> = isPast(proposal)
    ? [["Hoje", 0], ["Ontem", -1], ["Anteontem", -2]]
    : [["Hoje", 0], ["Amanhã", 1], ["Depois de amanhã", 2], ["Em 1 semana", 7]];
  return labelsAndOffsets.map(([label, offsetDays]) => ({ label, date: addDays(today, offsetDays) }));
}

/** Troca o dia da proposta. */
export function withDay(proposal: CaptureProposalDto, date: IsoDate): CaptureProposalDto {
  return { ...proposal, date };
}

export type TimeOption = { label: string; time: string | null };

/** Botões de horário, mais "Sem horário". */
export function timeOptions(): TimeOption[] {
  return [
    ...TIME_CHOICES.map((time) => ({ label: spokenTime(time), time: time as string | null })),
    { label: "Sem horário", time: null },
  ];
}

/** Horário só faz sentido com data (como no cadastro de tarefas): sem data a proposta fica como está. */
export function withTime(proposal: CaptureProposalDto, time: string | null): CaptureProposalDto {
  return proposal.date === null ? proposal : { ...proposal, time };
}

export type Creation =
  | { kind: "tarefa"; input: CreateTaskInput }
  | { kind: "lancamento"; input: LancamentoInput };

/** O que será gravado ao confirmar; `null` quando ainda falta a data de uma conta ou de uma entrada a receber. */
export function toCreation(proposal: CaptureProposalDto, today: IsoDate): Creation | null {
  if (!canConfirm(proposal)) return null;
  if (proposal.kind === "tarefa") {
    return {
      kind: "tarefa",
      input: { title: proposal.title, type: "tarefa", dueDate: proposal.date, dueTime: proposal.time, fatal: false },
    };
  }
  return {
    kind: "lancamento",
    input: {
      tipo: proposal.kind,
      descricao: proposal.description,
      valorCentavos: proposal.amountCents,
      categoria: proposal.category,
      // Só chega aqui sem data o que já foi pago (canConfirm): conta como de hoje.
      data: proposal.date ?? today,
      situacao: proposal.status,
      lembreteHora: proposal.time,
    },
  };
}
