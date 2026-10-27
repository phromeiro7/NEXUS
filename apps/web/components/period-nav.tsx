"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const BTN = "rounded border border-[var(--color-borda)] px-3 py-1 text-sm";

/** Navegação de período pela URL: `?d=` é a data âncora; sem ela vale "hoje". */
export function usePeriodNav() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();

  function href(patch: Record<string, string | null>): string {
    const next = new URLSearchParams(params?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    return qs === "" ? pathname : `${pathname}?${qs}`;
  }

  return {
    goTo: (date: string) => router.replace(href({ d: date })),
    openDay: (date: string) => router.push(href({ v: "dia", d: date })),
    goToday: () => router.replace(href({ d: null })),
  };
}

export function PeriodNav({
  label,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
  onToday,
}: {
  label: string;
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <button type="button" className={BTN} aria-label={prevLabel} onClick={onPrev}>
        ←
      </button>
      <button type="button" className={BTN} aria-label={nextLabel} onClick={onNext}>
        →
      </button>
      <button type="button" className={BTN} onClick={onToday}>
        Hoje
      </button>
      <h2 className="text-lg font-semibold">{label}</h2>
    </div>
  );
}
