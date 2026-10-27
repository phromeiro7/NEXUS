"use client";

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import {
  updateSettingsInputSchema,
  type SettingsDto,
  type UpdateSettingsResultDto,
} from "@aj/shared";
import { useUpdateSettings } from "@/hooks/queries";
import { ApiError } from "@/lib/api";
import { messageFor } from "@/lib/messages";
import { inputClass } from "./auth-form";
import { FieldError } from "./task-form";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

type Field = "timezone" | "uf" | "city" | "earlyReminderMinutes" | "briefingTime";
type Errors = Partial<Record<Field, string>>;

const FIELD_MESSAGE: Record<Field, string> = {
  timezone: "Fuso horário inválido.",
  uf: "UF inválida.",
  city: "Informe uma cidade de até 100 caracteres.",
  earlyReminderMinutes: "Informe minutos inteiros entre 0 e 1440.",
  briefingTime: "Hora inválida (use HH:mm).",
};

const REASON_TEXT: Record<string, string> = {
  hora_inexistente: "a hora não existe neste fuso",
  hora_ambigua: "a hora é ambígua neste fuso",
};

function errorsFromIssues(issues: unknown): Errors {
  const errors: Errors = {};
  if (!Array.isArray(issues)) return errors;
  for (const issue of issues) {
    const head = (issue as { path?: unknown[] } | null)?.path?.[0];
    if (typeof head === "string" && head in FIELD_MESSAGE) errors[head as Field] = FIELD_MESSAGE[head as Field];
  }
  return errors;
}

function timeZones(current: string): string[] {
  let list: string[] = [];
  try {
    list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    list = [];
  }
  const set = new Set([DEFAULT_TIMEZONE, current, ...list]);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Valores do servidor na mesma representação dos campos de entrada (strings). */
function baselineOf(s: SettingsDto) {
  return {
    timezone: s.timezone,
    uf: s.uf ?? "",
    city: s.city ?? "",
    minutes: String(s.earlyReminderMinutes),
    briefingTime: s.briefingTime,
  };
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function SkippedWarning({ skipped }: { skipped: UpdateSettingsResultDto["skipped"] }) {
  return (
    <div
      role="alert"
      className="rounded border-2 border-[var(--color-fatal)] p-3 text-sm text-[var(--color-texto)]"
    >
      <p className="font-semibold">
        Atenção: {skipped.length} {plural(skipped.length, "tarefa", "tarefas")} não{" "}
        {plural(skipped.length, "pôde", "puderam")} ter {plural(skipped.length, "o lembrete refeito", "os lembretes refeitos")}.
      </p>
      <ul className="mt-1 list-disc pl-5">
        {skipped.map((s) => (
          <li key={s.id}>
            <strong>{s.title}</strong>: {REASON_TEXT[s.reason] ?? "horário inválido neste fuso"}
          </li>
        ))}
      </ul>
      <p className="mt-1">
        {plural(skipped.length, "Essa tarefa manteve", "Essas tarefas mantiveram")} os lembretes anteriores
        (calculados com o fuso ou a antecedência antigos) e {plural(skipped.length, "precisa", "precisam")} ter o
        horário revisado.
      </p>
    </div>
  );
}

/** Formulário de configurações: envia somente os campos alterados. */
export function SettingsForm({ settings }: { settings: SettingsDto }) {
  const uid = useId();
  const update = useUpdateSettings();
  const busy = useRef(false);

  const zones = useMemo(() => timeZones(settings.timezone), [settings.timezone]);
  const [base, setBase] = useState(() => baselineOf(settings));
  const [seen, setSeen] = useState(settings);
  const [timezone, setTimezone] = useState(base.timezone);
  const [uf, setUf] = useState(base.uf);
  const [city, setCity] = useState(base.city);
  const [minutes, setMinutes] = useState(base.minutes);
  const [briefingTime, setBriefingTime] = useState(base.briefingTime);

  // Novos valores do servidor (refetch): campos não editados adotam o valor novo; os editados
  // mantêm o digitado. A linha de base sempre passa a ser o valor do servidor.
  if (seen !== settings) {
    const next = baselineOf(settings);
    if (timezone === base.timezone) setTimezone(next.timezone);
    if (uf === base.uf) setUf(next.uf);
    if (city === base.city) setCity(next.city);
    if (minutes === base.minutes) setMinutes(next.minutes);
    if (briefingTime === base.briefingTime) setBriefingTime(next.briefingTime);
    setBase(next);
    setSeen(settings);
  }
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<UpdateSettingsResultDto | null>(null);

  const id = (name: string) => `${uid}-${name}`;
  const clear = (field: Field) => {
    setErrors((e) => ({ ...e, [field]: undefined }));
    setResult(null);
  };
  const describe = (field: Field) => (errors[field] ? id(`${field}-erro`) : undefined);

  function buildPatch(): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    if (timezone !== base.timezone) patch.timezone = timezone;
    if (uf !== base.uf) patch.uf = uf || null;
    if (city.trim() !== base.city.trim()) patch.city = city.trim() || null;
    const n = minutes.trim() === "" ? Number.NaN : Number(minutes);
    if (minutes.trim() === "" || n !== Number(base.minutes)) patch.earlyReminderMinutes = n;
    if (briefingTime !== base.briefingTime) patch.briefingTime = briefingTime;
    return patch;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    setErrors({});
    setFormError(null);
    setResult(null);

    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      setFormError("Nenhuma alteração para salvar.");
      return;
    }
    const parsed = updateSettingsInputSchema.safeParse(patch);
    if (!parsed.success) {
      const found = errorsFromIssues(parsed.error.issues);
      setErrors(found);
      if (Object.keys(found).length === 0) setFormError(messageFor(null));
      return;
    }

    busy.current = true;
    try {
      const saved = await update.mutateAsync(parsed.data);
      // Re-baseline: o que foi enviado passa a ser o valor sincronizado com o servidor.
      setBase((b) => ({
        timezone: patch.timezone !== undefined ? timezone : b.timezone,
        uf: patch.uf !== undefined ? uf : b.uf,
        city: patch.city !== undefined ? city : b.city,
        minutes: patch.earlyReminderMinutes !== undefined ? minutes : b.minutes,
        briefingTime: patch.briefingTime !== undefined ? briefingTime : b.briefingTime,
      }));
      setResult(saved);
    } catch (error) {
      if (error instanceof ApiError && error.code === "entrada_invalida") {
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

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={id("timezone")} className="text-sm font-medium">
              Fuso horário
            </label>
            <select
              id={id("timezone")}
              value={timezone}
              onChange={(e) => {
                setTimezone(e.target.value);
                clear("timezone");
              }}
              aria-invalid={errors.timezone ? true : undefined}
              aria-describedby={describe("timezone")}
              className={inputClass}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <FieldError id={id("timezone-erro")} message={errors.timezone} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={id("uf")} className="text-sm font-medium">
              UF
            </label>
            <select
              id={id("uf")}
              value={uf}
              onChange={(e) => {
                setUf(e.target.value);
                clear("uf");
              }}
              aria-invalid={errors.uf ? true : undefined}
              aria-describedby={describe("uf")}
              className={inputClass}
            >
              <option value="">Não informar</option>
              {UFS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <FieldError id={id("uf-erro")} message={errors.uf} />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={id("city")} className="text-sm font-medium">
            Cidade
          </label>
          <input
            id={id("city")}
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              clear("city");
            }}
            aria-invalid={errors.city ? true : undefined}
            aria-describedby={describe("city")}
            className={inputClass}
          />
          <FieldError id={id("city-erro")} message={errors.city} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={id("minutes")} className="text-sm font-medium">
              Antecedência dos lembretes (minutos)
            </label>
            <input
              id={id("minutes")}
              type="number"
              min={0}
              max={1440}
              value={minutes}
              onChange={(e) => {
                setMinutes(e.target.value);
                clear("earlyReminderMinutes");
              }}
              aria-invalid={errors.earlyReminderMinutes ? true : undefined}
              aria-describedby={describe("earlyReminderMinutes")}
              className={inputClass}
            />
            <FieldError id={id("earlyReminderMinutes-erro")} message={errors.earlyReminderMinutes} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={id("briefing")} className="text-sm font-medium">
              Hora do briefing
            </label>
            <input
              id={id("briefing")}
              type="time"
              value={briefingTime}
              onChange={(e) => {
                setBriefingTime(e.target.value);
                clear("briefingTime");
              }}
              aria-invalid={errors.briefingTime ? true : undefined}
              aria-describedby={describe("briefingTime")}
              className={inputClass}
            />
            <FieldError id={id("briefingTime-erro")} message={errors.briefingTime} />
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
            disabled={update.isPending}
            className="rounded bg-[var(--color-destaque)] px-3 py-2 font-medium text-[var(--color-superficie)] disabled:opacity-60"
          >
            {update.isPending ? "Salvando…" : "Salvar configurações"}
          </button>
        </div>

        {result !== null && (
          <p role="status" className="text-sm">
            Configurações salvas. {result.remindersRebuilt}{" "}
            {plural(result.remindersRebuilt, "lembrete refeito", "lembretes refeitos")}.
          </p>
        )}
        {result !== null && result.skipped.length > 0 && <SkippedWarning skipped={result.skipped} />}
      </form>

      <section aria-labelledby={id("telegram")} className="flex flex-col gap-1">
        <h2 id={id("telegram")} className="text-lg font-semibold">
          Telegram
        </h2>
        <p className="text-sm">{settings.telegramLinked ? "Telegram vinculado" : "Telegram não vinculado"}</p>
        <p className="text-sm text-[var(--color-texto-suave,inherit)]">Vínculo disponível em breve</p>
      </section>
    </div>
  );
}
