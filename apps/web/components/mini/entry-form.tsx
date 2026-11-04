"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import type { IsoDate } from "@aj/shared";
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

type Kind = "gasto" | "entrada";
type Errors = Partial<Record<"valor" | "descricao" | "data", string>>;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function whenWords(date: IsoDate, today: IsoDate): string {
  if (date === today) return "hoje";
  if (date === addDays(today, 1)) return "amanhã";
  return formatShort(date);
}

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
  const ids = useId();
  const [kind, setKind] = useState<Kind>("gasto");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [date, setDate] = useState<string>(today);
  const [time, setTime] = useState("09:00");
  const [errors, setErrors] = useState<Errors>({});

  const incoming = kind === "entrada";
  const categories = incoming ? CATEGORIAS_ENTRADA : CATEGORIAS_GASTO;

  function chooseKind(next: Kind) {
    if (next === kind) return;
    setKind(next);
    setCategoria(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseValor(valor);
    const title = descricao.trim();
    const next: Errors = {};
    if (cents === null) next.valor = "Digite um valor maior que zero, como 119,90.";
    if (title === "") next.descricao = "Diga o que foi, por exemplo: internet.";
    if (!ISO.test(date)) next.data = pending ? "Escolha o dia do vencimento." : "Escolha o dia.";
    setErrors(next);
    if (Object.keys(next).length > 0 || cents === null) {
      const first = next.valor ? "valor" : next.descricao ? "descricao" : "data";
      document.getElementById(`${ids}-${first}`)?.focus();
      return;
    }
    const input: LancamentoInput = {
      tipo: incoming ? "entrada" : pending ? "conta" : "gasto",
      descricao: title.slice(0, 80),
      valorCentavos: cents,
      categoria,
      data: date as IsoDate,
      situacao: pending ? "a_pagar" : "paga",
      lembreteHora: pending && time !== "" ? time : null,
    };
    const saved = finance.add(input);
    if (saved === null) {
      setErrors({ valor: "Não foi possível salvar agora. Entre de novo e tente outra vez." });
      return;
    }
    toast({
      message: `${incoming ? "Entrada" : pending ? "Conta" : "Gasto"} anotado: ${title}, ${formatBRL(cents)}.`,
      undo: () => finance.remove(saved.id),
    });
    onSaved();
  }

  const preview = parseValor(valor);
  const hint =
    pending && ISO.test(date)
      ? time === ""
        ? `Vamos guardar o vencimento de ${whenWords(date as IsoDate, today)}, sem lembrete.`
        : `Lembrete anotado: ${whenWords(date as IsoDate, today)} às ${spokenTime(time)}.`
      : null;

  const chip = (label: string, pressed: boolean, onClick: () => void) => (
    <button key={label} type="button" className="mini-chip" aria-pressed={pressed} onClick={onClick}>
      {label}
    </button>
  );

  return (
      <form className="mini-form" onSubmit={submit} noValidate aria-label="Novo lançamento">
        <fieldset className="mini-step">
          <legend>Tipo</legend>
          <div className="mini-chips">
            {chip("Gasto", kind === "gasto", () => chooseKind("gasto"))}
            {chip("Entrada", kind === "entrada", () => chooseKind("entrada"))}
          </div>
        </fieldset>

        <div className="mini-stack">
          <label htmlFor={`${ids}-valor`} className="mini-label">
            Valor
            <span className="mini-money-field">
              <span aria-hidden="true">R$</span>
              <input
                id={`${ids}-valor`}
                className="mini-field"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                placeholder="119,90"
                aria-invalid={errors.valor ? true : undefined}
                aria-describedby={errors.valor ? `${ids}-valor-erro` : undefined}
              />
            </span>
          </label>
          {errors.valor && (
            <p id={`${ids}-valor-erro`} role="alert" className="mini-fielderr">
              {errors.valor}
            </p>
          )}
        </div>

        <div className="mini-stack">
          <label htmlFor={`${ids}-descricao`} className="mini-label">
            O que foi
            <input
              id={`${ids}-descricao`}
              className="mini-field"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={80}
              autoComplete="off"
              placeholder={incoming ? "Ex.: freela do site" : "Ex.: internet"}
              aria-invalid={errors.descricao ? true : undefined}
              aria-describedby={errors.descricao ? `${ids}-descricao-erro` : undefined}
            />
          </label>
          {errors.descricao && (
            <p id={`${ids}-descricao-erro`} role="alert" className="mini-fielderr">
              {errors.descricao}
            </p>
          )}
        </div>

        <fieldset className="mini-step">
          <legend>Categoria (opcional)</legend>
          <div className="mini-chips">{categories.map((c) => chip(c, categoria === c, () => setCategoria(categoria === c ? null : c)))}</div>
        </fieldset>

        <fieldset className="mini-step">
          <legend>Situação</legend>
          <div className="mini-chips">
            {chip(incoming ? "Já recebi" : "Já paguei", !pending, () => setPending(false))}
            {chip(incoming ? "Vou receber" : "Vou pagar", pending, () => setPending(true))}
          </div>
        </fieldset>

        <div className="mini-form-row">
          <div className="mini-stack">
            <label htmlFor={`${ids}-data`} className="mini-label">
              {pending ? "Vence em" : "Dia"}
              <input
                id={`${ids}-data`}
                type="date"
                className="mini-field"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-invalid={errors.data ? true : undefined}
                aria-describedby={errors.data ? `${ids}-data-erro` : undefined}
              />
            </label>
          </div>
          {pending && (
            <div className="mini-stack">
              <label htmlFor={`${ids}-hora`} className="mini-label">
                Lembrar às
                <input id={`${ids}-hora`} type="time" className="mini-field" value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
          )}
        </div>
        {errors.data && (
          <p id={`${ids}-data-erro`} role="alert" className="mini-fielderr" style={{ marginTop: -12 }}>
            {errors.data}
          </p>
        )}

        {hint && <p className="mini-summary">{hint}</p>}
        {preview !== null && descricao.trim() !== "" && (
          <p className="mini-hint" style={{ marginTop: -8 }}>
            Será anotado: {descricao.trim()}, {formatBRL(preview)}.
          </p>
        )}

        <button type="submit" className="mini-btn primary">
          Salvar lançamento
        </button>
      </form>
  );
}
