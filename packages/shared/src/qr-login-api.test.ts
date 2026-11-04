import { describe, expect, it } from 'vitest';
import { QR_LOGIN_STATUSES, qrLoginCreateResultSchema, qrLoginStatusSchema } from './qr-login-api.js';

describe('qrLoginCreateResultSchema', () => {
  const ok = {
    id: '3f1c1b8e-6a63-4b0a-9a35-0d3b3f6a4a11',
    pollSecret: 'x'.repeat(43),
    deepLink: 'https://t.me/nexus_bot?start=login_abc',
    expiresAt: '2026-11-04T12:03:00.000Z',
  };
  it('aceita um pedido completo', () => {
    expect(qrLoginCreateResultSchema.safeParse(ok).success).toBe(true);
  });
  it('recusa id que não é uuid e segredo curto demais', () => {
    expect(qrLoginCreateResultSchema.safeParse({ ...ok, id: 'abc' }).success).toBe(false);
    expect(qrLoginCreateResultSchema.safeParse({ ...ok, pollSecret: 'curto' }).success).toBe(false);
  });
});

describe('qrLoginStatusSchema', () => {
  it('só conhece os estados combinados', () => {
    for (const status of QR_LOGIN_STATUSES) {
      expect(qrLoginStatusSchema.safeParse({ status, expiresAt: '2026-11-04T12:00:00.000Z' }).success).toBe(true);
    }
    expect(qrLoginStatusSchema.safeParse({ status: 'consumido', expiresAt: 'x' }).success).toBe(false);
  });
  it('o token é opcional e só texto', () => {
    expect(qrLoginStatusSchema.safeParse({ status: 'aprovado', expiresAt: 'x', tokenHash: 'abc' }).success).toBe(true);
    expect(qrLoginStatusSchema.safeParse({ status: 'aprovado', expiresAt: 'x', tokenHash: 1 }).success).toBe(false);
  });
});
