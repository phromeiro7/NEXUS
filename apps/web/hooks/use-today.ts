"use client";

import type { IsoDate } from "@aj/shared";
import { useEffect, useState } from "react";
import { todayIn } from "@/lib/dates";
import { useSettings } from "./queries";

const TICK_MS = 60_000;

function compute(timezone: string | undefined): IsoDate | null {
  if (timezone === undefined) return null;
  try {
    return todayIn(timezone, new Date());
  } catch {
    return null; // fuso inválido: sem data até as configurações serem corrigidas
  }
}

/** "Hoje" no fuso das configurações; null até elas carregarem (nunca usa a data do navegador). */
export function useToday(): IsoDate | null {
  const timezone = useSettings().data?.timezone;
  const [today, setToday] = useState<IsoDate | null>(() => compute(timezone));

  useEffect(() => {
    const update = () => setToday(compute(timezone));
    update();
    const timer = setInterval(update, TICK_MS);
    const onVisible = () => {
      if (document.visibilityState !== "hidden") update();
    };
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [timezone]);

  return today;
}
