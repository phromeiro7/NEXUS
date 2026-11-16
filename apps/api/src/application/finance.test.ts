import type { CreateFinanceEntryInput } from '@nexus/shared';
import { describe, expect, it } from 'vitest';
import { createFakes } from '../../test/fakes.js';
import { ConflictError, InvalidInputError, NotFoundError } from './errors.js';
import { makeFinanceUseCases } from './finance.js';

const U1 = 'user-1';
const U2 = 'user-2';
const NOW = new Date('2026-11-04T15:00:00Z');

function setup() {
  const fakes = createFakes({ now: NOW });
  const uc = makeFinanceUseCases({ finance: fakes.finance, clock: fakes.clock });
  return { fakes, uc };
}

const gasto = (over: Partial<CreateFinanceEntryInput> = {}): CreateFinanceEntryInput => ({
  kind: 'gasto',
  description: 'Almoço',
  amountCents: 4200,
  category: null,
  dueDate: '2026-11-04',
  status: 'paga',
  reminderTime: null,
  ...over,
});

const conta = (over: Partial<CreateFinanceEntryInput> = {}): CreateFinanceEntryInput =>
  gasto({ kind: 'conta', description: 'Aluguel', amountCents: 120000, status: 'a_pagar', reminderTime: '09:00', ...over });

describe('create', () => {
  it('o que já foi pago nasce com paidAt no instante atual', async () => {
    const { uc } = setup();
    const created = await uc.create(U1, gasto());
    expect(created).toMatchObject({ kind: 'gasto', amountCents: 4200, status: 'paga', paidAt: NOW.toISOString() });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('o que está a pagar nasce sem paidAt e guarda o horário do lembrete', async () => {
    const { uc } = setup();
    expect(await uc.create(U1, conta())).toMatchObject({ status: 'a_pagar', paidAt: null, reminderTime: '09:00' });
  });

  it('usa o id enviado pelo cliente e recusa repetir um id existente', async () => {
    const { uc } = setup();
    const id = '0b6f0c4e-1c1e-4e2a-9d3a-5f7f2d9f6a11';
    expect((await uc.create(U1, gasto({ id }))).id).toBe(id);
    await expect(uc.create(U1, gasto({ id }))).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('list', () => {
  it('devolve só os lançamentos do usuário e respeita os filtros', async () => {
    const { uc } = setup();
    await uc.create(U1, gasto({ dueDate: '2026-10-30' }));
    await uc.create(U1, conta({ dueDate: '2026-11-05' }));
    await uc.create(U1, gasto({ description: 'Café', dueDate: '2026-11-04' }));
    await uc.create(U2, gasto({ description: 'Do outro usuário' }));

    expect(await uc.list(U1, {})).toHaveLength(3);
    expect((await uc.list(U1, {})).map((e) => e.description)).not.toContain('Do outro usuário');
    expect(await uc.list(U1, { from: '2026-11-01', to: '2026-11-30' })).toHaveLength(2);
    expect((await uc.list(U1, { status: 'a_pagar' })).map((e) => e.description)).toEqual(['Aluguel']);
  });
});

describe('update', () => {
  it('pagar preenche paidAt e desfazer limpa paidAt; o horário do lembrete continua guardado', async () => {
    const { uc, fakes } = setup();
    const { id } = await uc.create(U1, conta());
    fakes.setNow(new Date('2026-11-05T12:00:00Z'));
    const paid = await uc.update(U1, id, { status: 'paga' });
    expect(paid).toMatchObject({ status: 'paga', paidAt: '2026-11-05T12:00:00.000Z', reminderTime: '09:00' });
    const undone = await uc.update(U1, id, { status: 'a_pagar' });
    expect(undone).toMatchObject({ status: 'a_pagar', paidAt: null, reminderTime: '09:00' });
  });

  it('pagar de novo uma conta já paga mantém o paidAt original', async () => {
    const { uc, fakes } = setup();
    const { id } = await uc.create(U1, conta());
    await uc.update(U1, id, { status: 'paga' });
    fakes.setNow(new Date('2026-11-09T12:00:00Z'));
    expect((await uc.update(U1, id, { status: 'paga' })).paidAt).toBe(NOW.toISOString());
  });

  it('edita descrição, valor, categoria e vencimento', async () => {
    const { uc } = setup();
    const { id } = await uc.create(U1, conta());
    const updated = await uc.update(U1, id, {
      description: 'Aluguel de novembro',
      amountCents: 125000,
      category: 'Moradia',
      dueDate: '2026-11-06',
    });
    expect(updated).toMatchObject({
      description: 'Aluguel de novembro',
      amountCents: 125000,
      category: 'Moradia',
      dueDate: '2026-11-06',
    });
  });

  it('recusa estado inconsistente: gasto voltando a ficar a pagar', async () => {
    const { uc } = setup();
    const g = await uc.create(U1, gasto());
    await expect(uc.update(U1, g.id, { status: 'a_pagar' })).rejects.toBeInstanceOf(InvalidInputError);
    expect((await uc.list(U1, {}))[0]).toMatchObject({ status: 'paga' });
  });

  it('não altera nem revela o lançamento de outro usuário', async () => {
    const { uc } = setup();
    const { id } = await uc.create(U1, conta());
    await expect(uc.update(U2, id, { status: 'paga' })).rejects.toBeInstanceOf(NotFoundError);
    expect((await uc.list(U1, {}))[0]).toMatchObject({ status: 'a_pagar' });
  });

  it('id inexistente é não encontrado', async () => {
    const { uc } = setup();
    await expect(uc.update(U1, 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', { status: 'paga' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('remove', () => {
  it('apaga o lançamento do próprio usuário', async () => {
    const { uc } = setup();
    const { id } = await uc.create(U1, gasto());
    await uc.remove(U1, id);
    expect(await uc.list(U1, {})).toEqual([]);
  });

  it('não apaga o de outro usuário e diz que não existe', async () => {
    const { uc } = setup();
    const { id } = await uc.create(U1, gasto());
    await expect(uc.remove(U2, id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await uc.list(U1, {})).toHaveLength(1);
    await expect(uc.remove(U1, id)).resolves.toBeUndefined();
    await expect(uc.remove(U1, id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
