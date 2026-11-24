import { todayIn, type IsoDate } from '@nexus/shared';

/** Largura da janela de envio do briefing depois de `briefingTime` (Ruling 19). */
export const BRIEFING_WINDOW_MINUTES = 4 * 60;

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR;

/** `HH:mm` ou `HH:mm:ss` (os segundos são ignorados). */
const BRIEFING_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

/** Minutos desde a meia-noite LOCAL no fuso dado (nunca o fuso do servidor). */
function localMinutesSinceMidnight(timeZone: string, now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(now);
  const readPart = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  // `% 24` protege contra motores que ainda formatam meia-noite como "24".
  return (readPart('hour') % HOURS_PER_DAY) * MINUTES_PER_HOUR + readPart('minute');
}

function previousDay(date: IsoDate): IsoDate {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10) as IsoDate;
}

/**
 * Se `now` está dentro da janela [briefingTime, briefingTime + 4 h] (ambos inclusive, na hora local
 * do fuso), devolve a data local do `briefingTime`; senão `null`. Se a janela cruza a meia-noite, os
 * minutos depois da meia-noite pertencem à data local do dia anterior (o dia do `briefingTime`).
 * `briefingTime`: `HH:mm` ou `HH:mm:ss`. Horário de verão: a janela é medida em hora de parede.
 */
export function briefingLocalDate(now: Date, timeZone: string, briefingTime: string): IsoDate | null {
  const timeMatch = BRIEFING_TIME_PATTERN.exec(briefingTime);
  if (!timeMatch) throw new RangeError('Invalid briefing time');
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const windowStart = hour * MINUTES_PER_HOUR + minute;
  const windowEnd = windowStart + BRIEFING_WINDOW_MINUTES;
  const currentMinutes = localMinutesSinceMidnight(timeZone, now);
  const today = todayIn(timeZone, now);
  if (currentMinutes >= windowStart && currentMinutes <= windowEnd) return today;
  // Janela que passa da meia-noite: o trecho de hoje cedo pertence ao briefing de ontem.
  const windowCrossesMidnight = windowEnd >= MINUTES_PER_DAY;
  if (windowCrossesMidnight && currentMinutes <= windowEnd - MINUTES_PER_DAY) return previousDay(today);
  return null;
}
