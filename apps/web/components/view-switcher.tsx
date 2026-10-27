"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const VIEWS = [
  { id: "dia", label: "Dia" },
  { id: "semana", label: "Semana" },
  { id: "mes", label: "Mês" },
] as const;
export type ViewId = (typeof VIEWS)[number]["id"];

export function parseView(v: string | null): ViewId {
  return VIEWS.find((x) => x.id === v)?.id ?? "dia";
}

export function ViewSwitcher({ view }: { view: ViewId }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();

  function select(id: ViewId) {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (id === "dia") next.delete("v");
    else next.set("v", id);
    const qs = next.toString();
    router.replace(qs === "" ? pathname : `${pathname}?${qs}`);
  }

  return (
    <div role="group" aria-label="Visão do painel" className="flex gap-1">
      {VIEWS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => select(id)}
          className={`min-h-10 rounded border border-[var(--color-borda)] px-3 py-1 text-sm ${
            view === id ? "bg-[var(--color-destaque)] font-semibold text-[var(--color-superficie)]" : ""
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
