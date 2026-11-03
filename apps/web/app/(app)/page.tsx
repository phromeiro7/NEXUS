"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { DayView } from "@/components/day-view";
import { MonthView } from "@/components/month-view";
import { QuickAdd } from "@/components/quick-add";
import { SummaryAside } from "@/components/summary-aside";
import { parseView, ViewSwitcher } from "@/components/view-switcher";
import { WeekView } from "@/components/week-view";
import { parseAnchor } from "@/lib/dates";

function Painel() {
  const params = useSearchParams();
  const view = parseView(params?.get("v") ?? null);
  const anchor = parseAnchor(params?.get("d") ?? null);
  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 data-after-delete-focus tabIndex={-1} className="text-2xl font-semibold outline-none">
          Painel
        </h1>
        <ViewSwitcher view={view} />
      </div>
      <QuickAdd />
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0">
          {view === "dia" && <DayView date={anchor} />}
          {view === "semana" && <WeekView anchor={anchor} />}
          {view === "mes" && (
            <MonthView
              year={anchor ? Number(anchor.slice(0, 4)) : undefined}
              month={anchor ? Number(anchor.slice(5, 7)) : undefined}
            />
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
