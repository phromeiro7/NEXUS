"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import {
  calculateDeadlineInputSchema,
  type CalculateDeadlineInput,
  type CalculateDeadlineResultDto,
  type CountType,
} from "@aj/shared";
import { useApi } from "@/components/auth-provider";
import { formatLongDate } from "@/lib/dates";
import { messageFor } from "@/lib/messages";
import { inputClass } from "./field";
import { TaskForm } from "./task-form";

const RANGE_ERROR = "Informe a data da publicação e os dias (inteiro de 1 a 365).";

/** Calculadora avulsa de prazos; o resultado pode virar uma tarefa já em modo "calcular prazo". */
export function DeadlineCalculator() {
  const api = useApi();
  const uid = useId();
  const busy = useRef(false);
  const [baseDate, setBaseDate] = useState("");
  const [days, setDays] = useState("");
  const [countType, setCountType] = useState<CountType>("uteis");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<{
    rule: CalculateDeadlineInput;
    result: CalculateDeadlineResultDto;
  } | null>(null);
  const [creating, setCreating] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    setShown(null);
    setCreating(false);
    const parsed = calculateDeadlineInputSchema.safeParse({
      baseDate,
      days: days.trim() === "" ? Number.NaN : Number(days),
      countType,
    });
    if (!parsed.success) {
      setError(RANGE_ERROR);
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await api.calculateDeadline(parsed.data);
      setShown({ rule: parsed.data, result });
    } catch (err) {
      setShown(null);
      setError(messageFor(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  /** Qualquer edição invalida o resultado exibido e fecha o painel de criação. */
  const edited = () => {
    setShown(null);
    setCreating(false);
  };

  const id = (name: string) => `${uid}-${name}`;

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={id("base")} className="text-sm font-medium">
              Data da publicação
            </label>
            <input
              id={id("base")}
              type="date"
              value={baseDate}
              onChange={(e) => {
                setBaseDate(e.target.value);
                edited();
              }}
              aria-invalid={error === RANGE_ERROR ? true : undefined}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={id("days")} className="text-sm font-medium">
              Quantidade de dias
            </label>
            <input
              id={id("days")}
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => {
                setDays(e.target.value);
                edited();
              }}
              aria-invalid={error === RANGE_ERROR ? true : undefined}
              aria-describedby={error ? id("erro") : undefined}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={id("count")} className="text-sm font-medium">
              Tipo de contagem
            </label>
            <select
              id={id("count")}
              value={countType}
              onChange={(e) => {
                setCountType(e.target.value as CountType);
                edited();
              }}
              className={inputClass}
            >
              <option value="uteis">Dias úteis</option>
              <option value="corridos">Dias corridos</option>
            </select>
          </div>
        </div>
        {error && (
          <p id={id("erro")} role="alert" className="text-sm text-[var(--color-fatal)]">
            {error}
          </p>
        )}
        <div>
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-[var(--color-destaque)] px-3 py-2 font-medium text-[var(--color-superficie)] disabled:opacity-60"
          >
            {pending ? "Calculando…" : "Calcular"}
          </button>
        </div>
      </form>

      {shown && (
        <section aria-label="Resultado" role="status" className="flex flex-col gap-2 text-sm">
          <p className="text-lg font-semibold">Vence em {formatLongDate(shown.result.dueDate)}</p>
          {shown.result.prorrogado && <p>Prorrogado para o próximo dia útil.</p>}
          {shown.result.feriadosDescontados.length > 0 ? (
            <div>
              <p>Feriados descontados:</p>
              <ul className="list-disc pl-5">
                {shown.result.feriadosDescontados.map((h) => (
                  <li key={h.date}>
                    {h.date.slice(8, 10)}/{h.date.slice(5, 7)}/{h.date.slice(0, 4)} — {h.name}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>Nenhum feriado descontado.</p>
          )}
          {!creating && (
            <div>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="rounded border border-[var(--color-borda)] px-3 py-2"
              >
                Criar tarefa com este prazo
              </button>
            </div>
          )}
        </section>
      )}

      {shown && creating && (
        <section
          role="region"
          aria-label="Nova tarefa com prazo"
          className="rounded border border-[var(--color-borda)] p-3"
        >
          <h2 className="mb-2 font-semibold">Nova tarefa com prazo</h2>
          <TaskForm
            key={`${shown.rule.baseDate}|${shown.rule.days}|${shown.rule.countType}`}
            initial={{ deadline: shown.rule, calculated: { rule: shown.rule, result: shown.result } }}
            onDone={() => setCreating(false)}
          />
        </section>
      )}

      <p className="text-sm text-[var(--color-texto)]">
        Confira sempre a contagem no tribunal; feriados locais dependem do seu cadastro.
      </p>
    </div>
  );
}
