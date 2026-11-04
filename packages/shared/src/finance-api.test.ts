import { describe, expect, it } from 'vitest';
import {
  createFinanceEntryInputSchema,
  FINANCE_MAX_CENTS,
  listFinanceEntriesQuerySchema,
  updateFinanceEntryInputSchema,
} from './finance-api.js';

const conta = {
  kind: 'conta',
  description: 'Aluguel',
  amountCents: 120000,
  dueDate: '2026-11-05',
  status: 'a_pagar',
  reminderTime: '09:00',
};

describe('createFinanceEntryInputSchema', () => {
  it('aceita uma conta a pagar e aplica os padrões', () => {
    const parsed = createFinanceEntryInputSchema.parse({ ...conta, description: ' Aluguel ' });
    expect(parsed).toMatchObject({ description: 'Aluguel', category: null, reminderTime: '09:00' });
    const gasto = createFinanceEntryInputSchema.parse({
      kind: 'gasto',
      description: 'Almoço',
      amountCents: 4200,
      dueDate: '2026-11-04',
    });
    expect(gasto).toMatchObject({ status: 'paga', category: null, reminderTime: null });
  });

  it('aceita um id vindo do cliente (criação otimista e restauração)', () => {
    const id = '0b6f0c4e-1c1e-4e2a-9d3a-5f7f2d9f6a11';
    expect(createFinanceEntryInputSchema.parse({ ...conta, id }).id).toBe(id);
    expect(createFinanceEntryInputSchema.safeParse({ ...conta, id: 'abc' }).success).toBe(false);
  });

  it('exige valor em centavos inteiros, positivo e dentro do limite', () => {
    for (const amountCents of [0, -1, 10.5, FINANCE_MAX_CENTS + 1, '100']) {
      expect(createFinanceEntryInputSchema.safeParse({ ...conta, amountCents }).success).toBe(false);
    }
    expect(createFinanceEntryInputSchema.safeParse({ ...conta, amountCents: FINANCE_MAX_CENTS }).success).toBe(true);
  });

  it('rejeita descrição vazia ou longa, categoria longa, data e hora inválidas', () => {
    expect(createFinanceEntryInputSchema.safeParse({ ...conta, description: '  ' }).success).toBe(false);
    expect(createFinanceEntryInputSchema.safeParse({ ...conta, description: 'a'.repeat(121) }).success).toBe(false);
    expect(createFinanceEntryInputSchema.safeParse({ ...conta, category: 'a'.repeat(41) }).success).toBe(false);
    expect(createFinanceEntryInputSchema.safeParse({ ...conta, dueDate: '2026-02-31' }).success).toBe(false);
    expect(createFinanceEntryInputSchema.safeParse({ ...conta, reminderTime: '25:00' }).success).toBe(false);
  });

  it('gasto nasce pago; conta e entrada podem estar a pagar', () => {
    expect(createFinanceEntryInputSchema.safeParse({ ...conta, kind: 'gasto' }).success).toBe(false);
    expect(createFinanceEntryInputSchema.safeParse({ ...conta, status: 'paga' }).success).toBe(true);
    expect(
      createFinanceEntryInputSchema.safeParse({ ...conta, kind: 'entrada', status: 'a_pagar' }).success,
    ).toBe(true);
  });

  it('não aceita tipo ou situação desconhecidos', () => {
    expect(createFinanceEntryInputSchema.safeParse({ ...conta, kind: 'outro' }).success).toBe(false);
    expect(createFinanceEntryInputSchema.safeParse({ ...conta, status: 'atrasada' }).success).toBe(false);
  });
});

describe('updateFinanceEntryInputSchema', () => {
  it('aceita marcar paga ou desfazer e exige ao menos um campo', () => {
    expect(updateFinanceEntryInputSchema.parse({ status: 'paga' })).toEqual({ status: 'paga' });
    expect(updateFinanceEntryInputSchema.safeParse({ status: 'a_pagar' }).success).toBe(true);
    expect(updateFinanceEntryInputSchema.safeParse({}).success).toBe(false);
  });

  it('valida cada campo como na criação', () => {
    expect(updateFinanceEntryInputSchema.safeParse({ amountCents: 0 }).success).toBe(false);
    expect(updateFinanceEntryInputSchema.safeParse({ description: '' }).success).toBe(false);
    expect(updateFinanceEntryInputSchema.safeParse({ reminderTime: null, category: null }).success).toBe(true);
  });

  it('não permite trocar o tipo nem o dono', () => {
    expect(updateFinanceEntryInputSchema.safeParse({ kind: 'gasto', status: 'paga' }).success).toBe(false);
    expect(updateFinanceEntryInputSchema.safeParse({ userId: 'x', status: 'paga' }).success).toBe(false);
  });
});

describe('listFinanceEntriesQuerySchema', () => {
  it('sem filtros devolve tudo', () => {
    expect(listFinanceEntriesQuerySchema.parse({})).toEqual({});
  });

  it('month vira o primeiro e o último dia do mês', () => {
    expect(listFinanceEntriesQuerySchema.parse({ month: '2026-11' })).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(listFinanceEntriesQuerySchema.parse({ month: '2028-02' })).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(listFinanceEntriesQuerySchema.safeParse({ month: '2026-13' }).success).toBe(false);
    expect(listFinanceEntriesQuerySchema.safeParse({ month: '2026-1' }).success).toBe(false);
  });

  it('aceita from/to e status, mas não month junto com from/to', () => {
    expect(listFinanceEntriesQuerySchema.parse({ from: '2026-01-01', to: '2026-12-31', status: 'a_pagar' })).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
      status: 'a_pagar',
    });
    expect(listFinanceEntriesQuerySchema.safeParse({ month: '2026-11', from: '2026-11-01' }).success).toBe(false);
    expect(listFinanceEntriesQuerySchema.safeParse({ from: '2026-12-01', to: '2026-01-01' }).success).toBe(false);
    expect(listFinanceEntriesQuerySchema.safeParse({ status: 'atrasada' }).success).toBe(false);
  });
});
