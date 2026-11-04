import { describe, expect, it } from 'vitest';
import { createFakes } from '../../test/fakes.js';
import { makeCaptureInterpretUseCases } from './capture-interpret.js';

// 2026-11-05 01:30 UTC ainda é 4 de novembro às 22h30 em São Paulo.
const NOW = new Date('2026-11-05T01:30:00Z');

function setup() {
  const fakes = createFakes({ now: NOW });
  return { fakes, uc: makeCaptureInterpretUseCases({ profiles: fakes.profiles, clock: fakes.clock }) };
}

describe('interpret', () => {
  it('lê a frase com o "hoje" do fuso da pessoa', async () => {
    const { uc } = setup();
    const out = await uc.interpret('u1', { text: 'gastei 100 em roupa' });
    expect(out.today).toBe('2026-11-04');
    expect(out.proposal).toMatchObject({ kind: 'gasto', amountCents: 10000, category: 'Roupas', date: '2026-11-04', status: 'paga' });
  });

  it('usa o fuso das configurações, não o do servidor', async () => {
    const { fakes, uc } = setup();
    fakes.setProfile('u1', { timezone: 'Asia/Tokyo' });
    expect((await uc.interpret('u1', { text: 'gastei 100 em roupa' })).today).toBe('2026-11-05');
  });

  it('entende uma tarefa com dia e horário e não assume o que não foi dito', async () => {
    const { uc } = setup();
    expect((await uc.interpret('u1', { text: 'ligar pra vidinha hoje 14h' })).proposal).toMatchObject({
      kind: 'tarefa',
      title: 'ligar pra vidinha',
      date: '2026-11-04',
      time: '14:00',
    });
    expect((await uc.interpret('u1', { text: 'comprar ração' })).proposal).toMatchObject({ kind: 'tarefa', date: null, time: null });
  });

  it('devolve proposal null quando as regras não entendem', async () => {
    const { uc } = setup();
    expect((await uc.interpret('u1', { text: 'quanto eu gastei esse mês?' })).proposal).toBeNull();
    expect((await uc.interpret('u1', { text: 'oi' })).proposal).toBeNull();
  });
});
