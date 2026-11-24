import type { IsoDate } from '@nexus/shared';

/** Resultado de `localToUtc`: o instante, ou o motivo pelo qual a hora local não tem instante único. */
export type LocalToUtcResult =
  | { ok: true; utc: Date }
  | { ok: false; reason: 'hora_inexistente' | 'hora_ambigua' };

const MS_PER_SECOND = 1000;
const MS_PER_DAY = 24 * 60 * 60 * MS_PER_SECOND;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Deslocamento (ms) do fuso em relação a UTC no instante dado: hora local - UTC. */
function utcOffsetMsAt(formatter: Intl.DateTimeFormat, instantMs: number): number {
  const localFields: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') localFields[part.type] = Number(part.value);
  }
  const localAsUtc = Date.UTC(
    localFields.year!,
    localFields.month! - 1,
    localFields.day,
    localFields.hour,
    localFields.minute,
    localFields.second,
  );
  // O formatador só vai até segundos: descarta os milissegundos do instante para comparar igual com igual.
  const instantWholeSecondsMs = Math.floor(instantMs / MS_PER_SECOND) * MS_PER_SECOND;
  return localAsUtc - instantWholeSecondsMs;
}

/**
 * Converte data + hora de parede (HH:mm) num fuso IANA para um instante absoluto.
 * Recusa adivinhar: hora pulada pelo horário de verão = `hora_inexistente`;
 * hora repetida = `hora_ambigua`. Entrada inválida lança `RangeError`.
 */
export function localToUtc(date: IsoDate, time: string, timeZone: string): LocalToUtcResult {
  const timeMatch = TIME_PATTERN.exec(time);
  if (!timeMatch) throw new RangeError(`Invalid time (expected HH:mm): ${time}`);
  if (!ISO_DATE_PATTERN.test(date)) throw new RangeError(`Invalid date (expected YYYY-MM-DD): ${date}`);
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  // A hora de parede tratada como se fosse UTC; o deslocamento real é subtraído depois.
  const localAsUtcMs = Date.UTC(year, month - 1, day, Number(timeMatch[1]), Number(timeMatch[2]));
  // `Date.UTC` normaliza datas inexistentes (31/02 vira 03/03): se a volta não bate, a data é inválida.
  const normalized = new Date(localAsUtcMs);
  const isRealCalendarDate =
    normalized.getUTCFullYear() === year && normalized.getUTCMonth() === month - 1 && normalized.getUTCDate() === day;
  if (!isRealCalendarDate) throw new RangeError(`Invalid calendar date: ${date}`);

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
  // Basta: em zonas IANA reais há no máximo uma transição em +-24h (inclusive Apia 2011).
  const candidateOffsets = new Set([
    utcOffsetMsAt(formatter, localAsUtcMs - MS_PER_DAY),
    utcOffsetMsAt(formatter, localAsUtcMs + MS_PER_DAY),
  ]);
  // Um candidato só vale se, naquele instante, o fuso realmente usa o deslocamento que o gerou.
  const matchingInstants = new Set<number>();
  for (const offset of candidateOffsets) {
    const candidateMs = localAsUtcMs - offset;
    if (utcOffsetMsAt(formatter, candidateMs) === offset) matchingInstants.add(candidateMs);
  }

  if (matchingInstants.size === 0) return { ok: false, reason: 'hora_inexistente' };
  if (matchingInstants.size > 1) return { ok: false, reason: 'hora_ambigua' };
  return { ok: true, utc: new Date([...matchingInstants][0]!) };
}
