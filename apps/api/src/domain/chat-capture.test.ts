import type { IsoDate } from '@nexus/shared';
import { describe, expect, it } from 'vitest';
import { interpretCapture } from './chat-capture.js';

// 2026-11-04 é uma quarta-feira.
const today = '2026-11-04' as IsoDate;
const read = (text: string, now: IsoDate = today) => interpretCapture(text, now);

describe('gastos', () => {
  it('gastei 100 em roupa', () => {
    expect(read('gastei 100 em roupa')).toEqual({
      kind: 'gasto',
      description: 'roupa',
      amountCents: 10_000,
      category: 'Roupas',
      date: today,
      time: null,
      status: 'paga',
    });
  });

  it('paguei 42 no almoço', () => {
    expect(read('paguei 42 no almoço')).toMatchObject({ kind: 'gasto', amountCents: 4200, description: 'almoço', category: 'Lazer' });
  });

  it('comprei pão 12,50', () => {
    expect(read('comprei pão 12,50')).toMatchObject({ kind: 'gasto', amountCents: 1250, description: 'pão', category: 'Mercado' });
  });

  it('uber 23,90 sem verbo nem data', () => {
    expect(read('uber 23,90')).toMatchObject({ kind: 'gasto', amountCents: 2390, description: 'uber', category: 'Transporte', date: today });
  });

  it('aceita R$, milhar e vírgula decimal', () => {
    expect(read('gastei R$ 1.200,50 no mercado')).toMatchObject({ amountCents: 120_050, category: 'Mercado' });
    expect(read('gastei R$100 em roupa')).toMatchObject({ amountCents: 10_000 });
    expect(read('gastei 1.200 em roupa')).toMatchObject({ amountCents: 120_000 });
    expect(read('gastei 100 reais em roupa')).toMatchObject({ amountCents: 10_000, description: 'roupa' });
  });

  it('sem descrição usa um nome neutro e sem categoria', () => {
    expect(read('gastei 100')).toMatchObject({ kind: 'gasto', description: 'Gasto', category: null, amountCents: 10_000 });
  });

  it('sem categoria conhecida deixa a categoria vazia', () => {
    expect(read('gastei 40 com a vidinha')).toMatchObject({ kind: 'gasto', description: 'vidinha', category: null });
  });

  it('gasto no passado: ontem, dia N e dia da semana apontam para trás', () => {
    expect(read('gastei 100 em roupa ontem')).toMatchObject({ date: '2026-11-03' });
    expect(read('gastei 100 em roupa dia 2')).toMatchObject({ date: '2026-11-02' });
    expect(read('gastei 100 em roupa dia 28')).toMatchObject({ date: '2026-10-28' });
    expect(read('gastei 100 em roupa na sexta')).toMatchObject({ date: '2026-10-30' });
    expect(read('gastei 100 em roupa na quarta')).toMatchObject({ date: today });
    expect(read('gastei 100 em roupa 28/10')).toMatchObject({ date: '2026-10-28' });
  });
});

describe('entradas', () => {
  it('recebi 1500 do freela', () => {
    expect(read('recebi 1500 do freela')).toEqual({
      kind: 'entrada',
      description: 'freela',
      amountCents: 150_000,
      category: 'Freela',
      date: today,
      time: null,
      status: 'paga',
    });
  });

  it('entrou 300', () => {
    expect(read('entrou 300')).toMatchObject({ kind: 'entrada', amountCents: 30_000, description: 'Entrada', status: 'paga' });
  });

  it('vou receber vira entrada a receber com a data dita', () => {
    expect(read('vou receber 800 do aluguel dia 10')).toMatchObject({
      kind: 'entrada',
      amountCents: 80_000,
      status: 'a_pagar',
      date: '2026-11-10',
      description: 'aluguel',
    });
  });

  it('salário vira categoria Salário', () => {
    expect(read('recebi 4500 de salário')).toMatchObject({ kind: 'entrada', category: 'Salário', amountCents: 450_000 });
  });
});

describe('contas a pagar', () => {
  it('luz 187,40 vence dia 8', () => {
    expect(read('luz 187,40 vence dia 8')).toEqual({
      kind: 'conta',
      description: 'luz',
      amountCents: 18_740,
      category: 'Moradia',
      date: '2026-11-08',
      time: null,
      status: 'a_pagar',
    });
  });

  it('aluguel 1200 amanhã: número solto com palavra de conta e data futura', () => {
    expect(read('aluguel 1200 amanhã')).toMatchObject({
      kind: 'conta',
      amountCents: 120_000,
      description: 'aluguel',
      date: '2026-11-05',
      status: 'a_pagar',
    });
  });

  it('pagar internet 119,90 dia 10', () => {
    expect(read('pagar internet 119,90 dia 10')).toMatchObject({ kind: 'conta', description: 'internet', date: '2026-11-10', amountCents: 11_990 });
  });

  it('conta sem data fica sem data (o bot pergunta)', () => {
    expect(read('pagar luz 187,40')).toMatchObject({ kind: 'conta', date: null, status: 'a_pagar' });
    expect(read('boleto da escola 900')).toMatchObject({ kind: 'conta', date: null, amountCents: 90_000 });
  });

  it('dia N já passado neste mês vai para o mês seguinte; dia inexistente procura o próximo mês válido', () => {
    expect(read('luz 187,40 vence dia 2')).toMatchObject({ date: '2026-12-02' });
    expect(read('luz 187,40 vence dia 31', '2026-11-04' as IsoDate)).toMatchObject({ date: '2026-12-31' });
    expect(read('luz 187,40 vence dia 4')).toMatchObject({ date: today });
  });

  it('data dd/mm e dia da semana (próxima ocorrência, nunca hoje)', () => {
    expect(read('luz 187,40 vence 15/11')).toMatchObject({ date: '2026-11-15' });
    expect(read('luz 187,40 vence 02/01')).toMatchObject({ date: '2027-01-02' });
    expect(read('luz 187,40 vence 02/01/2028')).toMatchObject({ date: '2028-01-02' });
    expect(read('luz 187,40 vence sexta')).toMatchObject({ date: '2026-11-06' });
    expect(read('luz 187,40 vence quarta')).toMatchObject({ date: '2026-11-11' });
    expect(read('luz 187,40 vence segunda-feira')).toMatchObject({ date: '2026-11-09' });
  });

  it('horário numa conta vira horário do lembrete', () => {
    expect(read('luz 187,40 vence amanhã 9h')).toMatchObject({ kind: 'conta', time: '09:00', date: '2026-11-05' });
  });
});

describe('tarefas', () => {
  it('ligar pra vidinha hoje 14h', () => {
    expect(read('ligar pra vidinha hoje 14h')).toEqual({
      kind: 'tarefa',
      title: 'ligar pra vidinha',
      date: today,
      time: '14:00',
      vagueTime: false,
    });
  });

  it('comprar ração amanhã', () => {
    expect(read('comprar ração amanhã')).toMatchObject({ kind: 'tarefa', title: 'comprar ração', date: '2026-11-05', time: null });
  });

  it('reunião sexta 9h30', () => {
    expect(read('reunião sexta 9h30')).toMatchObject({ kind: 'tarefa', title: 'reunião', date: '2026-11-06', time: '09:30' });
  });

  it('sem data fica sem data e nunca assume horário', () => {
    expect(read('ligar pra Ana')).toMatchObject({ kind: 'tarefa', title: 'ligar pra Ana', date: null, time: null });
  });

  it('formas de horário: 14h30, 14:30, às 14, 14 horas, meio-dia', () => {
    expect(read('dentista amanhã 14h30')).toMatchObject({ time: '14:30' });
    expect(read('dentista amanhã 14:30')).toMatchObject({ time: '14:30' });
    expect(read('dentista amanhã às 14')).toMatchObject({ time: '14:00', title: 'dentista' });
    expect(read('dentista amanhã 14 horas')).toMatchObject({ time: '14:00' });
    expect(read('almoçar com a mãe sábado meio-dia')).toMatchObject({ time: '12:00', date: '2026-11-07', title: 'almoçar com a mãe' });
  });

  it('de manhã, de tarde e de noite não viram horário: marca vagueTime', () => {
    expect(read('ligar pro banco amanhã de manhã')).toMatchObject({
      kind: 'tarefa',
      title: 'ligar pro banco',
      date: '2026-11-05',
      time: null,
      vagueTime: true,
    });
    expect(read('academia hoje à noite')).toMatchObject({ time: null, vagueTime: true, title: 'academia' });
  });

  it('depois de amanhã e ontem', () => {
    expect(read('renovar CNH depois de amanhã')).toMatchObject({ title: 'renovar CNH', date: '2026-11-06' });
    expect(read('pagar a babá ontem')).toMatchObject({ date: '2026-11-03' });
  });

  it('tira "me lembra de" do título', () => {
    expect(read('me lembra de ligar pro João amanhã 10h')).toMatchObject({ title: 'ligar pro João', date: '2026-11-05', time: '10:00' });
  });

  it('número solto numa tarefa não vira valor', () => {
    expect(read('reunião sala 5 amanhã')).toMatchObject({ kind: 'tarefa', title: 'reunião sala 5', date: '2026-11-05' });
    expect(read('comprar 2 pães')).toMatchObject({ kind: 'tarefa', title: 'comprar 2 pães', date: null });
  });

  it('tarefa com data e hora, sem hora válida, não inventa', () => {
    expect(read('ligar amanhã 25h')).toMatchObject({ kind: 'tarefa', time: null });
  });
});

describe('o que não entende', () => {
  it.each([
    '',
    '   ',
    'oi',
    'gastei com mercado', // verbo de dinheiro sem valor
    'recebi do freela', // idem
    'gastei 10 e 20 no mercado', // dois valores: ambíguo
    'luz 187,40 e água 90,00 vence dia 8',
    'amanhã', // só data, sem o que fazer
    '14h',
    'gastei 0 em roupa',
    'quanto gastei esse mês?', // pergunta
    'me explica como funciona o prazo em dobro', // frase solta, sem data nem verbo no infinitivo
    'academia',
  ])('%j devolve null', (text) => {
    expect(read(text)).toBeNull();
  });

  it('valor acima do limite do produto devolve null', () => {
    expect(read('gastei 1.000.000.000,00 em roupa')).toBeNull();
  });

  it('título longo demais devolve null', () => {
    expect(read(`ligar para ${'a'.repeat(250)}`)).toBeNull();
  });

  it('descrição de lançamento longa é cortada em 120', () => {
    const r = read(`gastei 10 em ${'b'.repeat(200)}`);
    expect(r).toMatchObject({ kind: 'gasto' });
    expect((r as { description: string }).description.length).toBe(120);
  });
});
