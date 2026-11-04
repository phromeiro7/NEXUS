import { describe, expect, it } from 'vitest';
import { inviteCodeSchema, inviteDtoSchema } from './invite-api.js';

describe('inviteCodeSchema', () => {
  it('aceita 12 caracteres do alfabeto sem ambíguos', () => {
    expect(inviteCodeSchema.safeParse('ABCDEFGHJKMN').success).toBe(true);
    expect(inviteCodeSchema.safeParse('23456789ABCD').success).toBe(true);
  });
  it('recusa tamanho errado e caracteres ambíguos', () => {
    expect(inviteCodeSchema.safeParse('ABCDEFGH').success).toBe(false);
    expect(inviteCodeSchema.safeParse('ABCDEFGHJKM0').success).toBe(false);
    expect(inviteCodeSchema.safeParse('abcdefghjkmn').success).toBe(false);
  });
});

describe('inviteDtoSchema', () => {
  it('valida o formato devolvido pela API', () => {
    const ok = inviteDtoSchema.safeParse({
      code: 'ABCDEFGHJKMN',
      link: 'https://t.me/Bot?start=ABCDEFGHJKMN',
      status: 'ativo',
      createdAt: '2026-11-04T12:00:00.000Z',
      expiresAt: '2026-11-11T12:00:00.000Z',
      usedAt: null,
      label: null,
    });
    expect(ok.success).toBe(true);
  });
});
