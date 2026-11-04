import { describe, expect, it } from 'vitest';
import { telegramAuthInputSchema } from './telegram-auth-api.js';

describe('telegramAuthInputSchema', () => {
  it('aceita só o initData, com tamanho razoável', () => {
    expect(telegramAuthInputSchema.safeParse({ initData: 'a=b&hash=c' }).success).toBe(true);
    expect(telegramAuthInputSchema.safeParse({ initData: '' }).success).toBe(false);
    expect(telegramAuthInputSchema.safeParse({ initData: 'x'.repeat(4097) }).success).toBe(false);
    expect(telegramAuthInputSchema.safeParse({}).success).toBe(false);
  });
  it('recusa campos extras, como um userId vindo do cliente', () => {
    expect(telegramAuthInputSchema.safeParse({ initData: 'k', userId: 'u1' }).success).toBe(false);
  });
});
