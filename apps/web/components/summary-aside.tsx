"use client";

import type { BriefingDto, TaskDto } from "@aj/shared";
import { useBriefing } from "@/hooks/queries";

function when(t: TaskDto): string {
  return `${t.dueDate ?? "sem data"}${t.dueTime ? ` às ${t.dueTime}` : ""}`;
}

export function SummaryAside() {
  const { data, isError, isPending } = useBriefing();
  return (
    <aside aria-label="Resumo" className="rounded border border-[var(--color-borda)] bg-[var(--color-superficie)] p-3 text-sm">
      <p className="mb-2 font-semibold">Resumo</p>
      {isPending && <p>Carregando…</p>}
      {isError && <p>Não foi possível carregar o resumo.</p>}
      {data && <Summary briefing={data} />}
    </aside>
  );
}

function Summary({ briefing }: { briefing: BriefingDto }) {
  const urgent = [...briefing.overdue, ...briefing.fatalToday, ...briefing.nextTwoDays].find(
    (t) => t.type === "prazo",
  );
  const hearing = [...briefing.hearingsToday, ...briefing.nextTwoDays].find((t) => t.type === "audiencia");
  return (
    <dl className="flex flex-col gap-2">
      <div>
        <dt className="text-[var(--color-texto-suave)]">Prazo mais urgente</dt>
        <dd>{urgent ? `${urgent.title} (${when(urgent)})` : "Nenhum"}</dd>
      </div>
      <div>
        <dt className="text-[var(--color-texto-suave)]">Próxima audiência</dt>
        <dd>{hearing ? `${hearing.title} (${when(hearing)})` : "Nenhuma"}</dd>
      </div>
      <div>
        <dt className="text-[var(--color-texto-suave)]">Atrasadas</dt>
        <dd className={briefing.overdue.length > 0 ? "font-semibold text-[var(--color-atraso)]" : undefined}>
          {briefing.overdue.length}
        </dd>
      </div>
    </dl>
  );
}
