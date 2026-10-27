"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import {
  createTaskInputSchema,
  deadlineRuleSchema,
  updateTaskInputSchema,
  type CalculateDeadlineResultDto,
  type CountType,
  type DeadlineRule,
  type IsoDate,
  type TaskDto,
  type TaskType,
} from "@aj/shared";
import { useApi } from "@/components/auth-provider";
import { useCases, useCreateTask, useUpdateTask } from "@/hooks/queries";
import { ApiError } from "@/lib/api";
import { formatLongDate } from "@/lib/dates";
import { messageFor } from "@/lib/messages";
import { inputClass } from "./auth-form";

/** Pré-preenchimento (ex.: calculadora da Tarefa 10); `deadline` abre o formulário em "calcular prazo". */
export type TaskFormInitial = {
  title?: string;
  type?: TaskType;
  caseId?: string | null;
  dueDate?: IsoDate | null;
  dueTime?: string | null;
  fatal?: boolean;
  deadline?: DeadlineRule;
};

type Field = "title" | "type" | "caseId" | "dueDate" | "dueTime" | "deadline";
type Errors = Partial<Record<Field, string>>;

const FIELD_MESSAGE: Record<Field, string> = {
  title: "Informe um título de até 200 caracteres.",
  type: "Tipo inválido.",
  caseId: "Processo inválido.",
  dueDate: "Data inválida.",
  dueTime: "Hora inválida (use HH:mm) e informe uma data.",
  deadline: "Confira a data base, os dias (1 a 365) e a contagem.",
};

function fieldOf(path: unknown): Field | null {
  const head = Array.isArray(path) ? path[0] : undefined;
  if (head === "baseDate" || head === "days" || head === "countType") return "deadline";
  return typeof head === "string" && head in FIELD_MESSAGE ? (head as Field) : null;
}

function errorsFromIssues(issues: unknown): Errors {
  const errors: Errors = {};
  if (!Array.isArray(issues)) return errors;
  for (const issue of issues) {
    const field = fieldOf((issue as { path?: unknown } | null)?.path);
    if (field) errors[field] = FIELD_MESSAGE[field];
  }
  return errors;
}

const TYPE_OPTIONS: Array<{ value: TaskType; label: string }> = [
  { value: "prazo", label: "Prazo" },
  { value: "tarefa", label: "Tarefa" },
  { value: "audiencia", label: "Audiência" },
];

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-[var(--color-fatal)]">
      {message}
    </p>
  );
}

/**
 * Cria (sem `task`) ou edita (com `task`, enviando só os campos alterados) uma tarefa.
 * Prazo: o botão "Calcular" chama a API (sem debounce, para não gerar chamadas a cada tecla) e só
 * então "Salvar" é aceito; o resultado perde validade se a regra mudar.
 */
export function TaskForm({
  task,
  initial,
  onDone,
}: {
  task?: TaskDto;
  initial?: TaskFormInitial;
  onDone: () => void;
}) {
  const api = useApi();
  const uid = useId();
  const casesQ = useCases();
  const create = useCreateTask();
  const update = useUpdateTask();
  const busy = useRef(false);

  const seed: TaskFormInitial = task
    ? {
        title: task.title,
        type: task.type,
        caseId: task.caseId,
        dueDate: task.dueDate,
        dueTime: task.dueTime,
        fatal: task.fatal,
      }
    : (initial ?? {});
  const seedRule = seed.deadline ?? initial?.deadline;
  const taskRule =
    task && task.baseDate !== null && task.periodDays !== null && task.countType !== null
      ? { baseDate: task.baseDate, days: task.periodDays, countType: task.countType }
      : null;

  const [title, setTitle] = useState(seed.title ?? "");
  const [type, setType] = useState<TaskType | "">(seed.type ?? "");
  const [caseId, setCaseId] = useState(seed.caseId ?? "");
  const [date, setDate] = useState<string>(seed.dueDate ?? "");
  const [time, setTime] = useState<string>(seed.dueTime ?? "");
  const [fatal, setFatal] = useState(seed.fatal ?? false);
  const [deadlineMode, setDeadlineMode] = useState(seedRule !== undefined && !task);
  const rule0 = seedRule ?? taskRule;
  const [baseDate, setBaseDate] = useState<string>(rule0?.baseDate ?? "");
  const [days, setDays] = useState(rule0 ? String(rule0.days) : "");
  const [countType, setCountType] = useState<CountType>(rule0?.countType ?? "uteis");
  const [calc, setCalc] = useState<{ key: string; result: CalculateDeadlineResultDto } | null>(null);
  const [calcPending, setCalcPending] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const pending = create.isPending || update.isPending;
  const rule = { baseDate, days: Number(days), countType };
  const ruleKey = `${baseDate}|${days}|${countType}`;
  const calcValid = calc !== null && calc.key === ruleKey;
  const timeEnabled = deadlineMode || date !== "";

  const clear = (field: Field) => setErrors((e) => ({ ...e, [field]: undefined }));
  const id = (name: string) => `${uid}-${name}`;

  const activeCases = (casesQ.data ?? []).filter((c) => c.status === "ativo" || c.id === caseId);

  async function runCalc() {
    setCalcError(null);
    const parsed = deadlineRuleSchema.safeParse(rule);
    if (!parsed.success) {
      setErrors((e) => ({ ...e, deadline: FIELD_MESSAGE.deadline }));
      return;
    }
    clear("deadline");
    setCalcPending(true);
    try {
      const result = await api.calculateDeadline(parsed.data);
      setCalc({ key: ruleKey, result });
    } catch (error) {
      setCalc(null);
      setCalcError(messageFor(error));
    } finally {
      setCalcPending(false);
    }
  }

  /** Corpo de criação (tudo que foi preenchido) ou de edição (apenas o que mudou). */
  function buildBody(): { body: Record<string, unknown>; sendsDeadline: boolean } | null {
    const effTime = timeEnabled && time !== "" ? time : null;
    if (!task) {
      const body: Record<string, unknown> = { title: title.trim(), caseId: caseId || null, fatal };
      if (type) body.type = type;
      if (deadlineMode) body.deadline = rule;
      else if (date) body.dueDate = date;
      if (effTime) body.dueTime = effTime;
      return { body, sendsDeadline: deadlineMode };
    }
    const patch: Record<string, unknown> = {};
    if (title.trim() !== task.title) patch.title = title.trim();
    if (type && type !== task.type) patch.type = type;
    if ((caseId || null) !== task.caseId) patch.caseId = caseId || null;
    if (fatal !== task.fatal) patch.fatal = fatal;
    let sendsDeadline = false;
    if (deadlineMode) {
      const same =
        taskRule !== null &&
        taskRule.baseDate === baseDate &&
        taskRule.days === Number(days) &&
        taskRule.countType === countType;
      if (!same) {
        patch.deadline = rule;
        sendsDeadline = true;
      }
    } else if ((date || null) !== task.dueDate) {
      patch.dueDate = date || null;
    }
    const finalTime = deadlineMode || date ? effTime : null;
    if (finalTime !== task.dueTime) patch.dueTime = finalTime;
    return Object.keys(patch).length === 0 ? null : { body: patch, sendsDeadline };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    setErrors({});
    setFormError(null);

    const built = buildBody();
    if (built === null) {
      setFormError("Nenhuma alteração para salvar.");
      return;
    }
    const parsed = task
      ? updateTaskInputSchema.safeParse(built.body)
      : createTaskInputSchema.safeParse(built.body);
    if (!parsed.success) {
      const found = errorsFromIssues(parsed.error.issues);
      setErrors(found);
      if (Object.keys(found).length === 0) setFormError(messageFor(null));
      return;
    }
    if (built.sendsDeadline && !calcValid) {
      setErrors({ deadline: "Calcule o prazo antes de salvar." });
      return;
    }

    busy.current = true;
    try {
      if (task) await update.mutateAsync({ id: task.id, input: parsed.data });
      else await create.mutateAsync(parsed.data as Parameters<typeof create.mutateAsync>[0]);
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.code === "hora_invalida") {
        setErrors({ dueTime: messageFor(error) });
      } else if (error instanceof ApiError && error.code === "entrada_invalida") {
        const found = errorsFromIssues((error.body as { issues?: unknown } | null)?.issues);
        setErrors(found);
        if (Object.keys(found).length === 0) setFormError(messageFor(error));
      } else {
        setFormError(messageFor(error));
      }
    } finally {
      busy.current = false;
    }
  }

  const describe = (field: Field) => (errors[field] ? id(`${field}-erro`) : undefined);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={id("title")} className="text-sm font-medium">
          Título
        </label>
        <input
          id={id("title")}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            clear("title");
          }}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={describe("title")}
          className={inputClass}
        />
        <FieldError id={id("title-erro")} message={errors.title} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={id("type")} className="text-sm font-medium">
            Tipo
          </label>
          <select
            id={id("type")}
            value={type}
            onChange={(e) => setType(e.target.value as TaskType | "")}
            aria-invalid={errors.type ? true : undefined}
            aria-describedby={describe("type")}
            className={inputClass}
          >
            {!task && <option value="">Automático</option>}
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <FieldError id={id("type-erro")} message={errors.type} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id("case")} className="text-sm font-medium">
            Processo
          </label>
          <select
            id={id("case")}
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            aria-invalid={errors.caseId ? true : undefined}
            aria-describedby={describe("caseId")}
            className={inputClass}
          >
            <option value="">Sem processo</option>
            {activeCases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.number}
                {c.clientName ? ` — ${c.clientName}` : ""}
              </option>
            ))}
          </select>
          <FieldError id={id("caseId-erro")} message={errors.caseId} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={deadlineMode}
          onChange={(e) => {
            setDeadlineMode(e.target.checked);
            clear("deadline");
          }}
        />
        Calcular prazo
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        {!deadlineMode && (
          <div className="flex flex-col gap-1">
            <label htmlFor={id("date")} className="text-sm font-medium">
              Data
            </label>
            <input
              id={id("date")}
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                clear("dueDate");
              }}
              aria-invalid={errors.dueDate ? true : undefined}
              aria-describedby={describe("dueDate")}
              className={inputClass}
            />
            <FieldError id={id("dueDate-erro")} message={errors.dueDate} />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor={id("time")} className="text-sm font-medium">
            Hora
          </label>
          <input
            id={id("time")}
            type="time"
            value={time}
            disabled={!timeEnabled}
            onChange={(e) => {
              setTime(e.target.value);
              clear("dueTime");
            }}
            aria-invalid={errors.dueTime ? true : undefined}
            aria-describedby={describe("dueTime")}
            className={`${inputClass} disabled:opacity-60`}
          />
          <FieldError id={id("dueTime-erro")} message={errors.dueTime} />
        </div>
      </div>

      {deadlineMode && (
        <fieldset className="flex flex-col gap-3 rounded border border-[var(--color-borda)] p-3">
          <legend className="px-1 text-sm font-medium">Cálculo do prazo</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={id("base")} className="text-sm font-medium">
                Data base
              </label>
              <input
                id={id("base")}
                type="date"
                value={baseDate}
                onChange={(e) => setBaseDate(e.target.value)}
                aria-invalid={errors.deadline ? true : undefined}
                aria-describedby={describe("deadline")}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={id("days")} className="text-sm font-medium">
                Dias
              </label>
              <input
                id={id("days")}
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                aria-invalid={errors.deadline ? true : undefined}
                aria-describedby={describe("deadline")}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={id("count")} className="text-sm font-medium">
                Contagem
              </label>
              <select
                id={id("count")}
                value={countType}
                onChange={(e) => setCountType(e.target.value as CountType)}
                aria-invalid={errors.deadline ? true : undefined}
                aria-describedby={describe("deadline")}
                className={inputClass}
              >
                <option value="uteis">Dias úteis</option>
                <option value="corridos">Dias corridos</option>
              </select>
            </div>
          </div>
          <FieldError id={id("deadline-erro")} message={errors.deadline} />
          <div>
            <button
              type="button"
              onClick={() => void runCalc()}
              disabled={calcPending}
              className="rounded border border-[var(--color-borda)] px-3 py-2 text-sm disabled:opacity-60"
            >
              {calcPending ? "Calculando…" : "Calcular"}
            </button>
          </div>
          {calcError && (
            <p role="alert" className="text-sm text-[var(--color-fatal)]">
              {calcError}
            </p>
          )}
          {calcValid && (
            <div role="status" className="text-sm">
              <p className="font-semibold">Vence em {formatLongDate(calc.result.dueDate)}</p>
              {calc.result.prorrogado && <p>Prorrogado para o próximo dia útil.</p>}
              {calc.result.feriadosDescontados.length > 0 ? (
                <>
                  <p>Feriados descontados:</p>
                  <ul className="list-disc pl-5">
                    {calc.result.feriadosDescontados.map((h) => (
                      <li key={h.date}>
                        {h.date.slice(8, 10)}/{h.date.slice(5, 7)} — {h.name}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>Nenhum feriado descontado.</p>
              )}
            </div>
          )}
        </fieldset>
      )}

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={fatal} onChange={(e) => setFatal(e.target.checked)} />
        Fatal
      </label>

      {formError !== null && (
        <p role="alert" className="text-sm text-[var(--color-fatal)]">
          {formError}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-[var(--color-destaque)] px-3 py-2 font-medium text-[var(--color-superficie)] disabled:opacity-60"
        >
          {pending ? "Salvando…" : "Salvar"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded border border-[var(--color-borda)] px-3 py-2"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
