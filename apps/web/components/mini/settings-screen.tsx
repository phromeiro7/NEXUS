"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { updateSettingsInputSchema, type SettingsDto } from "@aj/shared";
import { DISPLAY_NAME_MAX, useAuth } from "@/components/auth-provider";
import { useSettings, useUpdateSettings } from "@/hooks/queries";
import { messageFor } from "@/lib/messages";
import { BackIcon } from "./icons";
import { telegramFirstName } from "./telegram-bridge";
import { useToast } from "./toast";

const BRAZIL_ZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Belem",
  "America/Fortaleza",
  "America/Recife",
  "America/Bahia",
  "America/Cuiaba",
  "America/Campo_Grande",
  "America/Porto_Velho",
  "America/Rio_Branco",
  "America/Noronha",
];

const ZONE_LABEL: Record<string, string> = {
  "America/Sao_Paulo": "São Paulo (Brasília)",
  "America/Belem": "Belém",
  "America/Cuiaba": "Cuiabá",
  "America/Noronha": "Fernando de Noronha",
  "America/Bahia": "Bahia",
  "America/Campo_Grande": "Campo Grande",
  "America/Porto_Velho": "Porto Velho",
  "America/Rio_Branco": "Rio Branco",
};

const LEAD_PRESETS: Array<[number, string]> = [
  [0, "No horário da tarefa"],
  [5, "5 minutos antes"],
  [10, "10 minutos antes"],
  [15, "15 minutos antes"],
  [30, "30 minutos antes"],
  [60, "1 hora antes"],
  [120, "2 horas antes"],
  [1440, "1 dia antes"],
];

function otherZones(current: string): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  return [...new Set([current, ...all])].filter((z) => !BRAZIL_ZONES.includes(z)).sort((a, b) => a.localeCompare(b));
}

export function SettingsScreen() {
  const q = useSettings();
  const back = (
    <Link href="/mini" className="mini-back">
      <BackIcon /> Hoje
    </Link>
  );
  if (q.isError) {
    return (
      <main>
        {back}
        <p role="alert" className="mini-alert">
          Não foi possível carregar as configurações. Tente de novo em instantes.
        </p>
      </main>
    );
  }
  if (q.isPending) {
    return (
      <main role="status" aria-label="Carregando configurações">
        {back}
        <div className="mini-skeleton" style={{ marginTop: 16, height: 220 }} />
      </main>
    );
  }
  return <SettingsForm key={JSON.stringify(q.data)} settings={q.data} back={back} />;
}

function NameForm() {
  const { displayName, saveDisplayName } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(displayName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const suggestion = telegramFirstName();
  const changed = name.trim() !== (displayName ?? "");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!changed || saving) return;
    setSaving(true);
    setError(null);
    const { error: err } = await saveDisplayName(name);
    setSaving(false);
    if (err) setError(err);
    else toast({ message: name.trim() === "" ? "Nome removido." : `Combinado, vou te chamar de ${name.trim()}.` });
  }

  return (
    <form className="mini-card mini-sheet" onSubmit={submit} noValidate aria-label="Seu nome">
      <label className="mini-label">
        Como você quer ser chamado?
        <input
          className="mini-field"
          value={name}
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="given-name"
          placeholder="Seu nome ou apelido"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {suggestion !== "" && name.trim() === "" && (
        <button type="button" className="mini-btn quiet" style={{ justifyContent: "center" }} onClick={() => setName(suggestion)}>
          Usar “{suggestion}”, do seu Telegram
        </button>
      )}
      {error !== null && (
        <p role="alert" className="mini-fielderr">
          {error}
        </p>
      )}
      <button type="submit" className="mini-btn primary" disabled={!changed || saving} style={{ justifyContent: "center" }}>
        {saving ? "Salvando…" : "Salvar nome"}
      </button>
    </form>
  );
}

function SettingsForm({ settings, back }: { settings: SettingsDto; back: React.ReactNode }) {
  const update = useUpdateSettings();
  const toast = useToast();
  const busy = useRef(false);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [lead, setLead] = useState(String(settings.earlyReminderMinutes));
  const [briefing, setBriefing] = useState(settings.briefingTime);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string[]>([]);

  const leadOptions = LEAD_PRESETS.some(([m]) => String(m) === lead)
    ? LEAD_PRESETS
    : ([...LEAD_PRESETS, [Number(lead), `${lead} minutos antes`]] as Array<[number, string]>).sort((a, b) => a[0] - b[0]);
  const changed =
    timezone !== settings.timezone || lead !== String(settings.earlyReminderMinutes) || briefing !== settings.briefingTime;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current || !changed) return;
    const patch: Record<string, unknown> = {};
    if (timezone !== settings.timezone) patch.timezone = timezone;
    if (lead !== String(settings.earlyReminderMinutes)) patch.earlyReminderMinutes = Number(lead);
    if (briefing !== settings.briefingTime) patch.briefingTime = briefing;
    const parsed = updateSettingsInputSchema.safeParse(patch);
    if (!parsed.success) {
      setError("Confira o fuso e o horário do resumo (use HH:mm).");
      return;
    }
    busy.current = true;
    setError(null);
    setWarning([]);
    try {
      const saved = await update.mutateAsync(parsed.data);
      if (saved.skipped.length > 0) setWarning(saved.skipped.map((s) => s.title));
      else toast({ message: "Configurações salvas." });
    } catch (err) {
      setError(messageFor(err));
    } finally {
      busy.current = false;
    }
  }

  return (
    <main>
      {back}
      <header className="mini-hero">
        <h1 style={{ fontSize: "2rem" }}>Configurações</h1>
        <p className="mini-hero-date">Como o Nexus avisa você</p>
      </header>

      <NameForm />

      <form className="mini-card mini-sheet" onSubmit={submit} noValidate aria-label="Configurações">
        <label className="mini-label">
          Fuso horário
          <select className="mini-field" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            <optgroup label="Brasil">
              {BRAZIL_ZONES.map((z) => (
                <option key={z} value={z}>
                  {ZONE_LABEL[z] ?? z.replace("America/", "").replace(/_/g, " ")}
                </option>
              ))}
            </optgroup>
            <optgroup label="Outros">
              {otherZones(settings.timezone).map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="mini-label">
          Avisar com antecedência
          <select className="mini-field" value={lead} onChange={(e) => setLead(e.target.value)}>
            {leadOptions.map(([m, label]) => (
              <option key={m} value={String(m)}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="mini-label">
          Horário do resumo do dia
          <input type="time" className="mini-field" value={briefing} onChange={(e) => setBriefing(e.target.value)} />
        </label>
        {error !== null && (
          <p role="alert" className="mini-fielderr">
            {error}
          </p>
        )}
        <button type="submit" className="mini-btn primary" disabled={!changed || update.isPending} style={{ justifyContent: "center" }}>
          {update.isPending ? "Salvando…" : "Salvar alterações"}
        </button>
      </form>

      {warning.length > 0 && (
        <p role="alert" className="mini-alert">
          Salvo, mas não foi possível refazer o lembrete de: {warning.join(", ")}. Abra a tarefa e revise o horário.
        </p>
      )}

      <div className="mini-card">
        <dl className="mini-facts">
          <div>
            <dt>Telegram</dt>
            <dd>{settings.telegramLinked ? "Conectado" : "Ainda não conectado"}</dd>
          </div>
        </dl>
      </div>
    </main>
  );
}
