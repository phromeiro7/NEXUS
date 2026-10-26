import type { IsoDate } from '@aj/shared';

export type LocalToUtcResult =
  | { ok: true; utc: Date }
  | { ok: false; reason: 'hora_inexistente' | 'hora_ambigua' };

const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Deslocamento (ms) do fuso em relação a UTC no instante dado: hora local - UTC. */
function offsetAt(formatter: Intl.DateTimeFormat, instantMs: number): number {
  const p: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const localAsUtc = Date.UTC(p.year!, p.month! - 1, p.day, p.hour, p.minute, p.second);
  return localAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Converte data + hora de parede (HH:mm) num fuso IANA para um instante absoluto.
 * Recusa adivinhar: hora pulada pelo horário de verão = `hora_inexistente`;
 * hora repetida = `hora_ambigua`. Entrada inválida lança `RangeError`.
 */
export function localToUtc(date: IsoDate, time: string, timeZone: string): LocalToUtcResult {
  const match = TIME_RE.exec(time);
  if (!match) throw new RangeError(`Invalid time (expected HH:mm): ${time}`);
  const [y, m, day] = date.split('-').map(Number) as [number, number, number];
  const localMs = Date.UTC(y, m - 1, day, Number(match[1]), Number(match[2]));
  if (Number.isNaN(localMs)) throw new RangeError(`Invalid date: ${date}`);

  // Lança RangeError se o fuso for desconhecido.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });

  // Deslocamentos possíveis perto da hora local: um dia antes e um dia depois.
  const offsets = new Set([
    offsetAt(formatter, localMs - DAY_MS),
    offsetAt(formatter, localMs + DAY_MS),
  ]);
  const valid = new Set<number>();
  for (const offset of offsets) {
    const candidate = localMs - offset;
    if (offsetAt(formatter, candidate) === offset) valid.add(candidate);
  }

  if (valid.size === 0) return { ok: false, reason: 'hora_inexistente' };
  if (valid.size > 1) return { ok: false, reason: 'hora_ambigua' };
  return { ok: true, utc: new Date([...valid][0]!) };
}
