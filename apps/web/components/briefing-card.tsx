"use client";

import { renderBriefing } from "@aj/shared";
import { useBriefing } from "@/hooks/queries";

/** Briefing do dia em texto simples (o mesmo do Telegram), sem IA. Some quando vazio. */
export function BriefingCard() {
  const { data } = useBriefing();
  if (data === undefined) return null;
  const text = renderBriefing(data);
  if (text === "") return null;
  return (
    <section aria-labelledby="briefing-title" className="mb-4 rounded border border-[var(--color-borda)] bg-[var(--color-superficie)] p-3">
      <h2 id="briefing-title" className="mb-2 text-lg font-semibold">
        Briefing do dia
      </h2>
      <p data-testid="briefing-text" style={{ whiteSpace: "pre-line" }} className="break-words text-sm">
        {text}
      </p>
    </section>
  );
}
