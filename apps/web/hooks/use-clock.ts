"use client";

import { useEffect, useState } from "react";
import { clockIn } from "@/lib/mini-tasks";

const ONE_MINUTE_MS = 60_000;

/** Relógio local (HH:mm) no fuso informado, atualizado a cada minuto; `null` enquanto o fuso não chegou. */
export function useClock(timeZone: string | undefined): string | null {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), ONE_MINUTE_MS);
    return () => clearInterval(timer);
  }, []);
  return timeZone === undefined ? null : clockIn(timeZone, now);
}
