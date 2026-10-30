import { todayIn, type IsoDate } from '@aj/shared';

/** Largura da janela de envio do briefing depois de `briefingTime` (Ruling 19). */
export const BRIEFING_WINDOW_MINUTES = 4 * 60;

const MINUTES_PER_DAY = 24 * 60;

/** Minutos desde a meia-noite LOCAL no fuso dado (nunca o fuso do servidor). */
function localMinutes(timeZone: string, now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(now);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return (get('hour') % 24) * 60 + get('minute');
}

function previousDay(date: IsoDate): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10) as IsoDate;
}

/**
 * Se `now` está dentro da janela [briefingTime, briefingTime + 4 h] (ambos inclusive, na hora local
 * do fuso), devolve a data local do `briefingTime`; senão `null`. Se a janela cruza a meia-noite, os
 * minutos depois da meia-noite pertencem à data local do dia anterior (o dia do `briefingTime`).
 * `briefingTime`: `HH:mm` ou `HH:mm:ss`. Horário de verão: a janela é medida em hora de parede.
 */
export function briefingLocalDate(now: Date, timeZone: string, briefingTime: string): IsoDate | null {
  const [h, m] = briefingTime.split(':').map(Number) as [number, number];
  const start = h * 60 + m;
  const end = start + BRIEFING_WINDOW_MINUTES;
  const current = localMinutes(timeZone, now);
  const today = todayIn(timeZone, now);
  if (current >= start && current <= end) return today;
  if (end >= MINUTES_PER_DAY && current <= end - MINUTES_PER_DAY) return previousDay(today);
  return null;
}
