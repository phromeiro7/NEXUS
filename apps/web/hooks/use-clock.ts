"use client";

import { useEffect, useState } from "react";
import { clockIn } from "@/lib/mini-tasks";

/** Relógio local (HH:mm) no fuso informado, atualizado a cada minuto; `null` enquanto o fuso não chegou. */
export function useClock(timeZone: string | undefined): string | null {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return timeZone === undefined ? null : clockIn(timeZone, now);
}
