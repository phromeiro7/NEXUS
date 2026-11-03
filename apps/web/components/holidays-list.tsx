"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { createHolidayInputSchema, type HolidayDto, type HolidayScope } from "@aj/shared";
import { useCreateHoliday, useDeleteHoliday, useHolidays } from "@/hooks/queries";
import { messageFor } from "@/lib/messages";
import { ConfirmDialog } from "./confirm-dialog";
import { FieldError, inputClass } from "./field";

type Field = "date" | "scope" | "name";
type Errors = Partial<Record<Field, string>>;

const FIELD_MESSAGE: Record<Field, string> = {
  date: "Data inválida.",
  scope: "Escopo inválido.",
  name: "Informe um nome de até 100 caracteres.",
};

const SCOPE_LABEL: Record<HolidayScope, string> = { estadual: "Estadual", municipal: "Municipal" };

function formatDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/** Feriados locais: lista, cadastro (data, escopo, nome) e remoção com confirmação. */
export function HolidaysList() {
  const uid = useId();
  const holidaysQ = useHolidays();
  const create = useCreateHoliday();
  const del = useDeleteHoliday();
  const returnRef = useRef<HTMLElement | null>(null);

  const [date, setDate] = useState("");
  const [scope, setScope] = useState<HolidayScope>("estadual");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<HolidayDto | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const id = (n: string) => `${uid}-${n}`;
  const clear = (field: Field) => {
    setErrors((e) => ({ ...e, [field]: undefined }));
    setFormError(null);
  };
  const describe = (field: Field) => (errors[field] ? id(`${field}-erro`) : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (create.isPending) return;
    setErrors({});
    setFormError(null);
    const parsed = createHolidayInputSchema.safeParse({ date, scope, name: name.trim() });
    if (!parsed.success) {
      const found: Errors = {};
      for (const issue of parsed.error.issues) {
        const head = issue.path[0];
        if (typeof head === "string" && head in FIELD_MESSAGE) found[head as Field] = FIELD_MESSAGE[head as Field];
      }
      setErrors(found);
      return;
    }
    try {
      await create.mutateAsync(parsed.data);
      setDate("");
      setName("");
    } catch (error) {
      setFormError(messageFor(error));
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setListError(null);
    try {
      await del.mutateAsync(removing.id);
    } catch (error) {
      setListError(messageFor(error));
    } finally {
      setRemoving(null);
    }
  }

  const holidays = holidaysQ.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {holidaysQ.isError ? (
        <p role="alert" className="text-sm text-[var(--color-fatal)]">
          {messageFor(holidaysQ.error)}
        </p>
      ) : holidaysQ.isPending ? (
        <p className="text-sm">Carregando feriados…</p>
      ) : holidays.length === 0 ? (
        <p className="text-sm">Nenhum feriado local cadastrado.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-borda)] rounded border border-[var(--color-borda)]">
          {holidays.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
              <span className="break-words">
                <time dateTime={h.date}>{formatDate(h.date)}</time> · {SCOPE_LABEL[h.scope]} ·{" "}
                <span className="font-medium">{h.name}</span>
              </span>
              <button
                type="button"
                aria-label={`Remover ${h.name}`}
                className="min-h-10 rounded border border-[var(--color-borda)] px-3 py-1 text-sm"
                onClick={(e) => {
                  returnRef.current = e.currentTarget;
                  setListError(null);
                  setRemoving(h);
                }}
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}
      {listError !== null && (
        <p role="alert" className="text-sm text-[var(--color-fatal)]">
          {listError}
        </p>
      )}

      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
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
                clear("date");
              }}
              aria-invalid={errors.date ? true : undefined}
              aria-describedby={describe("date")}
              className={inputClass}
            />
            <FieldError id={id("date-erro")} message={errors.date} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={id("scope")} className="text-sm font-medium">
              Escopo
            </label>
            <select
              id={id("scope")}
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as HolidayScope);
                clear("scope");
              }}
              aria-invalid={errors.scope ? true : undefined}
              aria-describedby={describe("scope")}
              className={inputClass}
            >
              <option value="estadual">Estadual</option>
              <option value="municipal">Municipal</option>
            </select>
            <FieldError id={id("scope-erro")} message={errors.scope} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={id("name")} className="text-sm font-medium">
              Nome
            </label>
            <input
              id={id("name")}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clear("name");
              }}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={describe("name")}
              className={inputClass}
            />
            <FieldError id={id("name-erro")} message={errors.name} />
          </div>
        </div>
        {formError !== null && (
          <p role="alert" className="text-sm text-[var(--color-fatal)]">
            {formError}
          </p>
        )}
        <div>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded bg-[var(--color-destaque)] px-3 py-2 font-medium text-[var(--color-superficie)] disabled:opacity-60"
          >
            {create.isPending ? "Adicionando…" : "Adicionar feriado"}
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={removing !== null}
        title="Remover feriado?"
        message={removing ? `“${removing.name}” (${formatDate(removing.date)}) será removido.` : ""}
        confirmLabel="Sim, remover"
        pending={del.isPending}
        returnFocusRef={returnRef}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
