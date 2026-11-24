"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { updateSettingsInputSchema, type SettingsDto } from "@nexus/shared";
import { DISPLAY_NAME_MAX_LENGTH, useAuth } from "@/components/auth-provider";
import { useSettings, useUpdateSettings } from "@/hooks/queries";
import { messageFor } from "@/lib/messages";
import { BackIcon } from "./icons";
import { InvitesCard } from "./invites-card";
import { TelegramCard } from "./telegram-card";
import { telegramFirstName } from "./telegram-bridge";
import { useToast } from "./toast";

/** Fusos do Brasil, listados primeiro no seletor. */
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

/** Nomes amigáveis para fusos cujo identificador não se lê bem; os demais usam o próprio identificador. */
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

/** Opções de antecedência do lembrete: [minutos, rótulo]. */
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

/**
 * Fusos fora do Brasil, em ordem alfabética. Inclui sempre o fuso atual da pessoa, mesmo que o
 * navegador não tenha `Intl.supportedValuesOf` (ou ele falhe), para o seletor nunca perdê-lo.
 */
function otherZones(current: string): string[] {
  let supportedZones: string[] = [];
  try {
    supportedZones =
      (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    supportedZones = [];
  }
  return [...new Set([current, ...supportedZones])]
    .filter((zone) => !BRAZIL_ZONES.includes(zone))
    .sort((first, second) => first.localeCompare(second));
}

/** Tela "Configurações" do Mini App (/mini/configuracoes), aberta pelo menu do cabeçalho. */
export function SettingsScreen() {
  const settingsQuery = useSettings();
  const backLink = (
    <Link href="/mini" className="mini-back">
      <BackIcon /> Hoje
    </Link>
  );
  if (settingsQuery.isError) {
    return (
      <main>
        {backLink}
        <p role="alert" className="mini-alert">
          Não foi possível carregar as configurações. Tente de novo em instantes.
        </p>
      </main>
    );
  }
  if (settingsQuery.isPending) {
    return (
      <main role="status" aria-label="Carregando configurações">
        {backLink}
        <div className="mini-skeleton" style={{ marginTop: 16, height: 220 }} />
      </main>
    );
  }
  // A key recria o formulário quando as configurações mudam no servidor, reiniciando os campos.
  return <SettingsForm key={JSON.stringify(settingsQuery.data)} settings={settingsQuery.data} back={backLink} />;
}

/** Campo "Como você quer ser chamado?", com sugestão do primeiro nome do Telegram. Usado no Mini App e no painel. */
export function NameForm() {
  const { displayName, saveDisplayName } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(displayName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const suggestion = telegramFirstName();
  const changed = name.trim() !== (displayName ?? "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!changed || saving) return;
    setSaving(true);
    setError(null);
    const { error: saveError } = await saveDisplayName(name);
    setSaving(false);
    if (saveError) setError(saveError);
    else toast({ message: name.trim() === "" ? "Nome removido." : `Combinado, vou te chamar de ${name.trim()}.` });
  }

  return (
    <form className="mini-card mini-sheet" onSubmit={submit} noValidate aria-label="Seu nome">
      <label className="mini-label">
        Como você quer ser chamado?
        <input
          className="mini-field"
          value={name}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          autoComplete="given-name"
          placeholder="Seu nome ou apelido"
          onChange={(event) => setName(event.target.value)}
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

/** Fuso, antecedência e horário do resumo, com o aviso de lembretes que não puderam ser refeitos. Usado no Mini App e no painel. */
export function SettingsFields({ settings }: { settings: SettingsDto }) {
  const update = useUpdateSettings();
  const toast = useToast();
  // Trava síncrona contra duplo envio (o isPending da mutation só muda no próximo render).
  const submitting = useRef(false);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [leadMinutes, setLeadMinutes] = useState(String(settings.earlyReminderMinutes));
  const [briefingTime, setBriefingTime] = useState(settings.briefingTime);
  const [error, setError] = useState<string | null>(null);
  const [skippedTaskTitles, setSkippedTaskTitles] = useState<string[]>([]);

  // Uma antecedência fora das opções (definida em outro lugar) entra na lista para não sumir do seletor.
  const isPresetLead = LEAD_PRESETS.some(([minutes]) => String(minutes) === leadMinutes);
  const leadOptions = isPresetLead
    ? LEAD_PRESETS
    : ([...LEAD_PRESETS, [Number(leadMinutes), `${leadMinutes} minutos antes`]] as Array<[number, string]>).sort(
        (first, second) => first[0] - second[0],
      );
  const changed =
    timezone !== settings.timezone ||
    leadMinutes !== String(settings.earlyReminderMinutes) ||
    briefingTime !== settings.briefingTime;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !changed) return;
    // Envia só o que mudou.
    const patch: Record<string, unknown> = {};
    if (timezone !== settings.timezone) patch.timezone = timezone;
    if (leadMinutes !== String(settings.earlyReminderMinutes)) patch.earlyReminderMinutes = Number(leadMinutes);
    if (briefingTime !== settings.briefingTime) patch.briefingTime = briefingTime;
    const parsed = updateSettingsInputSchema.safeParse(patch);
    if (!parsed.success) {
      setError("Confira o fuso e o horário do resumo (use HH:mm).");
      return;
    }
    submitting.current = true;
    setError(null);
    setSkippedTaskTitles([]);
    try {
      const saved = await update.mutateAsync(parsed.data);
      // Lembretes que o servidor não conseguiu reagendar com as novas configurações.
      if (saved.skipped.length > 0) setSkippedTaskTitles(saved.skipped.map((skippedTask) => skippedTask.title));
      else toast({ message: "Configurações salvas." });
    } catch (saveError) {
      setError(messageFor(saveError));
    } finally {
      submitting.current = false;
    }
  }

  return (
    <>
      <form className="mini-card mini-sheet" onSubmit={submit} noValidate aria-label="Configurações">
        <label className="mini-label">
          Fuso horário
          <select className="mini-field" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
            <optgroup label="Brasil">
              {BRAZIL_ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {ZONE_LABEL[zone] ?? zone.replace("America/", "").replace(/_/g, " ")}
                </option>
              ))}
            </optgroup>
            <optgroup label="Outros">
              {otherZones(settings.timezone).map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, " ")}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="mini-label">
          Avisar com antecedência
          <select className="mini-field" value={leadMinutes} onChange={(event) => setLeadMinutes(event.target.value)}>
            {leadOptions.map(([minutes, label]) => (
              <option key={minutes} value={String(minutes)}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="mini-label">
          Horário do resumo do dia
          <input type="time" className="mini-field" value={briefingTime} onChange={(event) => setBriefingTime(event.target.value)} />
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

      {skippedTaskTitles.length > 0 && (
        <p role="alert" className="mini-alert">
          Salvo, mas não foi possível refazer o lembrete de: {skippedTaskTitles.join(", ")}. Abra a tarefa e revise o horário.
        </p>
      )}
    </>
  );
}

/** Conteúdo da tela de Configurações depois que as configurações carregaram. */
function SettingsForm({ settings, back }: { settings: SettingsDto; back: React.ReactNode }) {
  return (
    <main>
      {back}
      <header className="mini-hero">
        <h1 style={{ fontSize: "2rem" }}>Configurações</h1>
        <p className="mini-hero-date">Como o Nexus avisa você</p>
      </header>

      <NameForm />

      <SettingsFields settings={settings} />

      <TelegramCard linked={settings.telegramLinked} paused={settings.channelPaused} />

      <InvitesCard />
    </main>
  );
}
