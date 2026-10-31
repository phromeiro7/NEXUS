import { createHash, timingSafeEqual } from 'node:crypto';

/** Compara em tempo constante: os dois lados viram SHA-256 (32 bytes), então o tamanho nunca vaza nem lança. */
export function secretsMatch(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
