"use client";

import { HolidaysList } from "@/components/holidays-list";
import { SettingsForm } from "@/components/settings-form";
import { useSettings } from "@/hooks/queries";
import { messageFor } from "@/lib/messages";

export default function ConfiguracoesPage() {
  const settingsQ = useSettings();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-4">
      <h1 className="text-2xl font-semibold">Configurações</h1>
      <section aria-labelledby="cfg-geral" className="flex flex-col gap-3">
        <h2 id="cfg-geral" className="text-lg font-semibold">
          Preferências
        </h2>
        {settingsQ.isError ? (
          <p role="alert" className="text-sm text-[var(--color-fatal)]">
            {messageFor(settingsQ.error)}
          </p>
        ) : settingsQ.data ? (
          <SettingsForm settings={settingsQ.data} />
        ) : (
          <p className="text-sm">Carregando configurações…</p>
        )}
      </section>
      <section aria-labelledby="cfg-feriados" className="flex flex-col gap-3">
        <h2 id="cfg-feriados" className="text-lg font-semibold">
          Feriados locais
        </h2>
        <HolidaysList />
      </section>
    </main>
  );
}
