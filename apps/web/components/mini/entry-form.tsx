"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import type { IsoDate } from "@nexus/shared";
import { useFinance } from "@/hooks/finance";
import { useToday } from "@/hooks/use-today";
import { addDays, formatShort } from "@/lib/dates";
import {
  CATEGORIAS_ENTRADA,
  CATEGORIAS_GASTO,
  formatBRL,
  parseValor,
  type LancamentoInput,
} from "@/lib/finance";
import { spokenTime } from "@/lib/mini-tasks";
import { BackIcon } from "./icons";
import { useToast } from "./toast";

type EntryKind = "gasto" | "entrada";
type FieldErrors = Partial<Record<"valor" | "descricao" | "data", string>>;

/** Data completa no formato AAAA-MM-DD (o input de data devolve "" quando incompleto). */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Tamanho máximo da descrição do lançamento. */
const DESCRIPTION_MAX_LENGTH = 80;
/** Horário sugerido para o lembrete de uma conta a pagar. */
const DEFAULT_REMINDER_TIME = "09:00";

/** "hoje", "amanhã" ou a data curta, para as frases de resumo do formulário. */
function whenWords(date: IsoDate, today: IsoDate): string {
  if (date === today) return "hoje";
  if (date === addDays(today, 1)) return "amanhã";
  return formatShort(date);
}

/** Página "Novo lançamento" do Mini App (/mini/financas/novo); ao salvar volta para Finanças. */
export function EntryForm() {
  const today = useToday();
  if (today === null) {
    return (
      <main role="status" aria-label="Carregando">
        <div className="mini-skeleton" style={{ marginTop: 16, height: 160 }} />
      </main>
    );
  }
  return <EntryFormContent today={today} />;
}

function EntryFormContent({ today }: { today: IsoDate }) {
  const router = useRouter();
  return (
    <main>
      <Link href="/mini/financas" className="mini-back">
        <BackIcon /> Finanças
      </Link>
      <h1 style={{ margin: "8px 0 0", fontSize: "1.75rem", letterSpacing: "-0.02em" }}>Novo lançamento</h1>
      <EntryFormFields today={today} onSaved={() => router.push("/mini/financas")} />
    </main>
  );
}

/** O formulário de lançamento sem moldura, para o Mini App (página) e o painel (diálogo). `onSaved` roda após salvar. */
export function EntryFormFields({ today, onSaved }: { today: IsoDate; onSaved: () => void }) {
  const toast = useToast();
  const finance = useFinance();
  const idPrefix = useId();
  const [kind, setKind] = useState<EntryKind>("gasto");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  // "Vou pagar" / "Vou receber": ainda não foi pago (ou recebido), então tem vencimento e lembrete.
  const [settlesLater, setSettlesLater] = useState(false);
  const [date, setDate] = useState<string>(today);
  const [time, setTime] = useState(DEFAULT_REMINDER_TIME);
  const [errors, setErrors] = useState<FieldErrors>({});

  const isIncoming = kind === "entrada";
  const categories = isIncoming ? CATEGORIAS_ENTRADA : CATEGORIAS_GASTO;

  /** Trocar o tipo limpa a categoria, porque gastos e entradas têm listas diferentes. */
  function chooseKind(nextKind: EntryKind) {
    if (nextKind === kind) return;
    setKind(nextKind);
    setCategoria(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const cents = parseValor(valor);
    const title = descricao.trim();
    const nextErrors: FieldErrors = {};
    if (cents === null) nextErrors.valor = "Digite um valor maior que zero, como 119,90.";
    if (title === "") nextErrors.descricao = "Diga o que foi, por exemplo: internet.";
    if (!ISO_DATE_PATTERN.test(date)) nextErrors.data = settlesLater ? "Escolha o dia do vencimento." : "Escolha o dia.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || cents === null) {
      // Leva o foco ao primeiro campo com erro, na ordem em que aparecem na tela.
      const firstInvalidField = nextErrors.valor ? "valor" : nextErrors.descricao ? "descricao" : "data";
      document.getElementById(`${idPrefix}-${firstInvalidField}`)?.focus();
      return;
    }
    // Gasto ainda não pago vira "conta" (a pagar); entrada continua "entrada" nos dois casos.
    const input: LancamentoInput = {
      tipo: isIncoming ? "entrada" : settlesLater ? "conta" : "gasto",
      descricao: title.slice(0, DESCRIPTION_MAX_LENGTH),
      valorCentavos: cents,
      categoria,
      data: date as IsoDate,
      situacao: settlesLater ? "a_pagar" : "paga",
      lembreteHora: settlesLater && time !== "" ? time : null,
    };
    const saved = finance.add(input);
    if (saved === null) {
      setErrors({ valor: "Não foi possível salvar agora. Entre de novo e tente outra vez." });
      return;
    }
    toast({
      message: `${isIncoming ? "Entrada" : settlesLater ? "Conta" : "Gasto"} anotado: ${title}, ${formatBRL(cents)}.`,
      undo: () => finance.remove(saved.id),
    });
    onSaved();
  }

  const previewCents = parseValor(valor);
  const reminderHint =
    settlesLater && ISO_DATE_PATTERN.test(date)
      ? time === ""
        ? `Vamos guardar o vencimento de ${whenWords(date as IsoDate, today)}, sem lembrete.`
        : `Lembrete anotado: ${whenWords(date as IsoDate, today)} às ${spokenTime(time)}.`
      : null;

  const renderChip = (label: string, pressed: boolean, onClick: () => void) => (
    <button key={label} type="button" className="mini-chip" aria-pressed={pressed} onClick={onClick}>
      {label}
    </button>
  );

  return (
      <form className="mini-form" onSubmit={submit} noValidate aria-label="Novo lançamento">
        <fieldset className="mini-step">
          <legend>Tipo</legend>
          <div className="mini-chips">
            {renderChip("Gasto", kind === "gasto", () => chooseKind("gasto"))}
            {renderChip("Entrada", kind === "entrada", () => chooseKind("entrada"))}
          </div>
        </fieldset>

        <div className="mini-stack">
          <label htmlFor={`${idPrefix}-valor`} className="mini-label">
            Valor
            <span className="mini-money-field">
              <span aria-hidden="true">R$</span>
              <input
                id={`${idPrefix}-valor`}
                className="mini-field"
                value={valor}
                onChange={(event) => setValor(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                placeholder="119,90"
                aria-invalid={errors.valor ? true : undefined}
                aria-describedby={errors.valor ? `${idPrefix}-valor-erro` : undefined}
              />
            </span>
          </label>
          {errors.valor && (
            <p id={`${idPrefix}-valor-erro`} role="alert" className="mini-fielderr">
              {errors.valor}
            </p>
          )}
        </div>

        <div className="mini-stack">
          <label htmlFor={`${idPrefix}-descricao`} className="mini-label">
            O que foi
            <input
              id={`${idPrefix}-descricao`}
              className="mini-field"
              value={descricao}
              onChange={(event) => setDescricao(event.target.value)}
              maxLength={DESCRIPTION_MAX_LENGTH}
              autoComplete="off"
              placeholder={isIncoming ? "Ex.: freela do site" : "Ex.: internet"}
              aria-invalid={errors.descricao ? true : undefined}
              aria-describedby={errors.descricao ? `${idPrefix}-descricao-erro` : undefined}
            />
          </label>
          {errors.descricao && (
            <p id={`${idPrefix}-descricao-erro`} role="alert" className="mini-fielderr">
              {errors.descricao}
            </p>
          )}
        </div>

        <fieldset className="mini-step">
          <legend>Categoria (opcional)</legend>
          <div className="mini-chips">{categories.map((category) =>
              renderChip(category, categoria === category, () => setCategoria(categoria === category ? null : category)),
            )}</div>
        </fieldset>

        <fieldset className="mini-step">
          <legend>Situação</legend>
          <div className="mini-chips">
            {renderChip(isIncoming ? "Já recebi" : "Já paguei", !settlesLater, () => setSettlesLater(false))}
            {renderChip(isIncoming ? "Vou receber" : "Vou pagar", settlesLater, () => setSettlesLater(true))}
          </div>
        </fieldset>

        <div className="mini-form-row">
          <div className="mini-stack">
            <label htmlFor={`${idPrefix}-data`} className="mini-label">
              {settlesLater ? "Vence em" : "Dia"}
              <input
                id={`${idPrefix}-data`}
                type="date"
                className="mini-field"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                aria-invalid={errors.data ? true : undefined}
                aria-describedby={errors.data ? `${idPrefix}-data-erro` : undefined}
              />
            </label>
          </div>
          {settlesLater && (
            <div className="mini-stack">
              <label htmlFor={`${idPrefix}-hora`} className="mini-label">
                Lembrar às
                <input id={`${idPrefix}-hora`} type="time" className="mini-field" value={time} onChange={(event) => setTime(event.target.value)} />
              </label>
            </div>
          )}
        </div>
        {errors.data && (
          <p id={`${idPrefix}-data-erro`} role="alert" className="mini-fielderr" style={{ marginTop: -12 }}>
            {errors.data}
          </p>
        )}

        {reminderHint && <p className="mini-summary">{reminderHint}</p>}
        {previewCents !== null && descricao.trim() !== "" && (
          <p className="mini-hint" style={{ marginTop: -8 }}>
            Será anotado: {descricao.trim()}, {formatBRL(previewCents)}.
          </p>
        )}

        <button type="submit" className="mini-btn primary">
          Salvar lançamento
        </button>
      </form>
  );
}
