"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { DayView } from "@/components/day-view";
import { SummaryAside } from "@/components/summary-aside";
import { parseView, ViewSwitcher } from "@/components/view-switcher";

function Painel() {
  const view = parseView(useSearchParams()?.get("v") ?? null);
  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Painel</h1>
        <ViewSwitcher view={view} />
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
        <div>
          {view === "dia" ? (
            <DayView />
          ) : (
            <p role="status">A visão {view === "semana" ? "Semana" : "Mês"} está em construção.</p>
          )}
        </div>
        <SummaryAside />
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <Painel />
    </Suspense>
  );
}
