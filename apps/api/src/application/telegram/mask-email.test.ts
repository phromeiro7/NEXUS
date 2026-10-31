import { describe, expect, it } from 'vitest';
import { maskEmail } from './mask-email.js';

describe('maskEmail', () => {
  it('keeps the first character, three stars and the full domain', () => {
    expect(maskEmail('paulo@exemplo.com.br')).toBe('p***@exemplo.com.br');
  });

  it('a one-character local part becomes a single star', () => {
    expect(maskEmail('p@exemplo.com')).toBe('*@exemplo.com');
  });

  it('keeps the original case of the first character and of the domain', () => {
    expect(maskEmail('Paulo@Exemplo.COM')).toBe('P***@Exemplo.COM');
  });

  it('plus-addressing never leaks the tag', () => {
    expect(maskEmail('paulo+segredo@exemplo.com')).toBe('p***@exemplo.com');
  });

  it('subdomains stay whole', () => {
    expect(maskEmail('ana@mail.sp.escritorio.adv.br')).toBe('a***@mail.sp.escritorio.adv.br');
  });

  it('a unicode local part keeps the first code point, never half a surrogate pair', () => {
    expect(maskEmail('ñandú@exemplo.com')).toBe('ñ***@exemplo.com');
    expect(maskEmail('😀abc@exemplo.com')).toBe('😀***@exemplo.com');
    expect(maskEmail('é@exemplo.com')).toBe('*@exemplo.com');
  });

  it('a very long local part is still masked to the first character', () => {
    expect(maskEmail(`${'a'.repeat(64)}@exemplo.com`)).toBe('a***@exemplo.com');
  });

  it('is unparsable (null) with no @, an empty side, spaces or more than 254 characters', () => {
    expect(maskEmail('')).toBeNull();
    expect(maskEmail('semarroba.com')).toBeNull();
    expect(maskEmail('@exemplo.com')).toBeNull();
    expect(maskEmail('paulo@')).toBeNull();
    expect(maskEmail('pa ulo@exemplo.com')).toBeNull();
    expect(maskEmail('paulo@exem plo.com')).toBeNull();
    expect(maskEmail(`${'a'.repeat(250)}@exemplo.com`)).toBeNull();
  });

  it('never returns the raw local part', () => {
    const out = maskEmail('segredoabc@exemplo.com')!;
    expect(out).not.toContain('segredoabc');
    expect(out).not.toContain('egredo');
  });
});
