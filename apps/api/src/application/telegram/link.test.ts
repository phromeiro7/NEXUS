import { describe, expect, it } from 'vitest';
import { createFakes } from '../../../test/fakes.js';
import { LinkCodeCollisionError, TelegramNotConfiguredError } from '../errors.js';
import type { LinkCodeRepository } from '../ports.js';
import { LINK_CODE_ALPHABET, LINK_CODE_LENGTH, LINK_CODE_TTL_MS, makeLinkUseCases } from './link.js';

const NOW = new Date('2026-10-26T12:00:00.000Z');
const clock = { now: () => NOW };

/** randomBytes falso: devolve a sequência dada (cíclica) em fatias de `n` bytes. */
function scripted(bytes: number[]): (n: number) => Uint8Array {
  let i = 0;
  return (n) => Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length]!);
}

describe('link code alphabet', () => {
  it('is exactly the 31 unambiguous characters', () => {
    expect(LINK_CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    expect(LINK_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(LINK_CODE_ALPHABET).size).toBe(31);
    expect(LINK_CODE_LENGTH).toBe(8);
    expect(LINK_CODE_TTL_MS).toBe(10 * 60_000);
  });
});

describe('createCode', () => {
  it('returns an 8-character code from the alphabet, the exact deepLink and expiry exactly +10 min', async () => {
    const f = createFakes({ now: NOW });
    const uc = makeLinkUseCases({ links: f.links, botUsername: 'meu_bot', clock });
    const dto = await uc.createCode('u1');
    expect(dto.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(dto.deepLink).toBe(`https://t.me/meu_bot?start=${dto.code}`);
    expect(dto.expiresAt).toBe('2026-10-26T12:10:00.000Z');
    expect(f.links.codesOf('u1')).toEqual([dto.code]);
  });

  it('a new code replaces the previous one of the same user', async () => {
    const f = createFakes({ now: NOW });
    const uc = makeLinkUseCases({ links: f.links, botUsername: 'meu_bot', clock });
    const first = await uc.createCode('u1');
    const second = await uc.createCode('u1');
    expect(f.links.codesOf('u1')).toEqual([second.code]);
    expect(f.links.codesOf('u1')).not.toContain(first.code);
  });

  it('rejection sampling: bytes 248..255 are never accepted, accepted bytes map by modulo 31', async () => {
    // 255, 254, 248 rejeitados; 247 % 31 = 30 -> '9'; depois 0..6 -> A..G.
    const f = createFakes({ now: NOW });
    const uc = makeLinkUseCases({
      links: f.links,
      botUsername: 'b_ot',
      clock,
      randomBytes: scripted([255, 254, 248, 247, 0, 1, 2, 3, 4, 5, 6]),
    });
    const { code } = await uc.createCode('u1');
    expect(code).toBe('9ABCDEFG');
  });

  it('a source that only yields rejected bytes does not loop forever', async () => {
    const f = createFakes({ now: NOW });
    const uc = makeLinkUseCases({ links: f.links, botUsername: 'b_ot', clock, randomBytes: scripted([255]) });
    await expect(uc.createCode('u1')).rejects.toThrow();
    expect(f.links.codesOf('u1')).toEqual([]);
  });

  it('distribution over many draws is uniform within tolerance (no modulo bias)', async () => {
    const f = createFakes({ now: NOW });
    const uc = makeLinkUseCases({ links: f.links, botUsername: 'b_ot', clock });
    const counts = new Map<string, number>();
    const draws = 6000;
    for (let i = 0; i < draws; i++) {
      const { code } = await uc.createCode('u1');
      for (const ch of code) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    const total = draws * 8;
    const expected = total / 31;
    expect(counts.size).toBe(31);
    for (const ch of LINK_CODE_ALPHABET) {
      // ~1550 por caractere, desvio ~39: 6 desvios de folga.
      expect(Math.abs((counts.get(ch) ?? 0) - expected)).toBeLessThan(240);
    }
  });

  it('with a deterministic full-range byte source the first characters are not over-represented', async () => {
    // Todos os 256 valores uma vez: só 0..247 contam, cada caractere sai exatamente 8 vezes.
    const all = Array.from({ length: 256 }, (_, i) => i);
    const f = createFakes({ now: NOW });
    const uc = makeLinkUseCases({ links: f.links, botUsername: 'b_ot', clock, randomBytes: scripted(all) });
    const counts = new Map<string, number>();
    for (let i = 0; i < 62; i++) {
      const { code } = await uc.createCode('u1');
      for (const ch of code) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    // 62 códigos x 8 = 496 caracteres = dois ciclos dos 248 bytes aceitos: cada letra exatamente 16 vezes.
    for (const ch of LINK_CODE_ALPHABET) expect(counts.get(ch)).toBe(16);
  });

  it('retries with a NEW code on a collision, up to 3 retries, then fails with the collision error', async () => {
    const attempts: string[] = [];
    const links: LinkCodeRepository = {
      ...createFakes({ now: NOW }).links,
      async create(_userId, code) {
        attempts.push(code);
        throw new LinkCodeCollisionError();
      },
    };
    const uc = makeLinkUseCases({ links, botUsername: 'b_ot', clock });
    await expect(uc.createCode('u1')).rejects.toBeInstanceOf(LinkCodeCollisionError);
    expect(attempts).toHaveLength(4);
    expect(new Set(attempts).size).toBe(4);
  });

  it('succeeds when only the first attempts collide, using the code that was stored', async () => {
    const attempts: string[] = [];
    const stored: string[] = [];
    const links: LinkCodeRepository = {
      ...createFakes({ now: NOW }).links,
      async create(_userId, code) {
        attempts.push(code);
        if (attempts.length <= 2) throw new LinkCodeCollisionError();
        stored.push(code);
      },
    };
    const uc = makeLinkUseCases({ links, botUsername: 'b_ot', clock });
    const dto = await uc.createCode('u1');
    expect(attempts).toHaveLength(3);
    expect(dto.code).toBe(stored[0]);
    expect(dto.deepLink).toBe(`https://t.me/b_ot?start=${dto.code}`);
  });

  it('other repository errors are not retried', async () => {
    let calls = 0;
    const links: LinkCodeRepository = {
      ...createFakes({ now: NOW }).links,
      async create() {
        calls += 1;
        throw new Error('banco fora');
      },
    };
    const uc = makeLinkUseCases({ links, botUsername: 'b_ot', clock });
    await expect(uc.createCode('u1')).rejects.toThrow('banco fora');
    expect(calls).toBe(1);
  });

  it('without a bot username fails with TelegramNotConfiguredError and stores nothing', async () => {
    const f = createFakes({ now: NOW });
    for (const botUsername of [undefined, '']) {
      const uc = makeLinkUseCases({ links: f.links, botUsername, clock });
      await expect(uc.createCode('u1')).rejects.toBeInstanceOf(TelegramNotConfiguredError);
    }
    expect(f.links.codesOf('u1')).toEqual([]);
  });
});

describe('unlink', () => {
  it('delegates to the repository for that user only', async () => {
    const f = createFakes({ now: NOW });
    f.links.setChat('u1', 111);
    f.links.setChat('u2', 222);
    const uc = makeLinkUseCases({ links: f.links, botUsername: 'b_ot', clock });
    await uc.unlink('u1');
    expect(f.links.chatFor('u1')).toBeNull();
    expect(f.links.chatFor('u2')).toBe(222);
  });
});
