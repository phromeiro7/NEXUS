import type { AssistantReplyDto } from '@nexus/shared';
import { describe, expect, it, vi } from 'vitest';
import { createFakes } from '../../../test/fakes.js';
import { makeFinanceUseCases } from '../finance.js';
import type { ProcessMessageInput } from '../assistant/process-message.js';
import { makeTaskUseCases } from '../tasks.js';
import { dayText, formatMoney, makeCaptureFlow, spokenTime } from './capture.js';
import { makeTelegramWebhookHandler } from './webhook.js';

// Segunda-feira 2026-10-26, 10:00 em São Paulo.
const NOW = new Date('2026-10-26T13:00:00Z');
const U1 = 'user-1';
const U2 = 'user-2';
const CHAT1 = 1001;
const CHAT2 = 2002;
const MINI = 'https://nexus.example.test';

type Logs = Array<{ level: string; event: string; fields: Record<string, unknown> }>;

function setup(opts: { assistantEnabled?: boolean; miniAppUrl?: string | null } = {}) {
  const fakes = createFakes({ now: NOW });
  const tasks = makeTaskUseCases({
    tasks: fakes.tasks,
    profiles: fakes.profiles,
    reminders: fakes.reminders,
    clock: fakes.clock,
  });
  const realFinance = makeFinanceUseCases({ finance: fakes.finance, clock: fakes.clock });
  const financeFail = { next: false };
  const finance = {
    ...realFinance,
    async create(...args: Parameters<typeof realFinance.create>) {
      if (financeFail.next) {
        financeFail.next = false;
        throw new Error('banco fora do ar');
      }
      return realFinance.create(...args);
    },
  };
  const logs: Logs = [];
  const logger = {
    info: (event: string, fields: Record<string, never>) => logs.push({ level: 'info', event, fields }),
    error: (event: string, fields: Record<string, never>) => logs.push({ level: 'error', event, fields }),
  };
  const miniAppUrl = opts.miniAppUrl === null ? undefined : (opts.miniAppUrl ?? MINI);
  const capture = makeCaptureFlow({
    captures: fakes.captures,
    tasks,
    finance,
    profiles: fakes.profiles,
    telegram: fakes.telegram,
    clock: fakes.clock,
    logger,
    ...(miniAppUrl !== undefined ? { miniAppUrl } : {}),
  });
  const processMessage = vi.fn<(i: ProcessMessageInput) => Promise<AssistantReplyDto>>(async () => ({
    reply: 'resposta do assistente',
    affectedTasks: [],
  }));
  const handle = makeTelegramWebhookHandler({
    links: fakes.links,
    events: fakes.inboundEvents,
    confirmations: fakes.confirmations,
    processMessage,
    telegram: fakes.telegram,
    clock: fakes.clock,
    logger,
    botUsername: 'meu_bot',
    capture,
    assistantEnabled: opts.assistantEnabled ?? false,
  });
  fakes.links.setChat(U1, CHAT1);
  fakes.links.setChat(U2, CHAT2);

  let updateId = 1;
  const say = async (chatId: number, text: string, extra: Record<string, unknown> = {}) => {
    await handle({
      update_id: updateId++,
      message: { message_id: 10 + updateId, chat: { id: chatId, type: 'private' }, text, ...extra },
    });
  };
  const lastSent = () => fakes.telegram.sent[fakes.telegram.sent.length - 1]!;
  const lastEdit = () => fakes.telegram.edits[fakes.telegram.edits.length - 1]!;
  const lastAnswer = () => fakes.telegram.answers[fakes.telegram.answers.length - 1]!;
  const labels = (kb: ReturnType<typeof lastSent>['keyboard'] | undefined) => (kb ?? []).flat().map((b) => b.text);
  /** callback_data do botão com esse rótulo no teclado mais recente (mensagem enviada ou editada). */
  const dataOf = (label: string): string => {
    const kb = (fakes.telegram.edits.length > 0 && fakes.telegram.edits.length >= 0 ? [lastEdit().keyboard, lastSent().keyboard] : [lastSent().keyboard]).filter(Boolean);
    for (const k of kb) for (const b of k!.flat()) if (b.text === label && 'callbackData' in b) return b.callbackData;
    throw new Error(`botão "${label}" não encontrado`);
  };
  const press = async (chatId: number, data: string, messageId = 777, callbackId = `cb${updateId}`) => {
    await handle({
      update_id: updateId++,
      callback_query: { id: callbackId, data, message: { message_id: messageId, chat: { id: chatId, type: 'private' } } },
    });
  };
  return { fakes, handle, say, press, lastSent, lastEdit, lastAnswer, labels, dataOf, processMessage, logs, finance, financeFail, tasks };
}

const buttonsOfLastSent = (s: ReturnType<typeof setup>) => s.labels(s.lastSent().keyboard);

describe('helpers', () => {
  it('formats money, times and days in the product voice', () => {
    expect(formatMoney(10_000)).toBe('R$ 100,00');
    expect(formatMoney(123_456)).toBe('R$ 1.234,56');
    expect(formatMoney(5)).toBe('R$ 0,05');
    expect(spokenTime('14:00')).toBe('14h');
    expect(spokenTime('09:30')).toBe('9h30');
    expect(dayText('2026-10-26' as never, '2026-10-26' as never)).toBe('hoje');
    expect(dayText('2026-10-27' as never, '2026-10-26' as never)).toBe('amanhã');
    expect(dayText('2026-10-25' as never, '2026-10-26' as never)).toBe('ontem');
    expect(dayText('2026-10-30' as never, '2026-10-26' as never)).toBe('sexta, 30/10');
    expect(dayText('2026-11-10' as never, '2026-10-26' as never)).toBe('10/11');
  });
});

describe('expense proposal', () => {
  it('shows a proposal with buttons and writes nothing before Confirmar', async () => {
    const s = setup();
    await s.say(CHAT1, 'gastei 100 em roupa');
    expect(s.lastSent().text).toBe('Anotei: R$ 100,00 em Roupas, hoje.');
    expect(buttonsOfLastSent(s)).toEqual(['Confirmar', 'Mudar categoria', 'Mudar data']);
    expect(await s.fakes.finance.list(U1, {})).toEqual([]);
    expect(s.processMessage).not.toHaveBeenCalled();
    // um id de proposta guardado com o id da mensagem enviada
    expect(s.fakes.captures.all()).toHaveLength(1);
    expect(s.fakes.captures.all()[0]!.messageId).not.toBeNull();
  });

  it('Confirmar creates a paid expense, edits the message and offers Desfazer and Ver no Nexus', async () => {
    const s = setup();
    await s.say(CHAT1, 'gastei 100 em roupa');
    await s.press(CHAT1, s.dataOf('Confirmar'));
    const [entry] = await s.fakes.finance.list(U1, {});
    expect(entry).toMatchObject({ kind: 'gasto', amountCents: 10_000, category: 'Roupas', status: 'paga', dueDate: '2026-10-26', description: 'roupa' });
    expect(s.lastEdit().text).toBe('Pronto, anotado. R$ 100,00 em Roupas, hoje.');
    expect(s.labels(s.lastEdit().keyboard)).toEqual(['Desfazer', 'Ver no Nexus']);
    const nexus = s.lastEdit().keyboard!.flat().find((b) => b.text === 'Ver no Nexus')!;
    expect(nexus).toEqual({ text: 'Ver no Nexus', webAppUrl: `${MINI}/mini/financas` });
    expect(s.lastAnswer().text).toBe('Anotado.');
  });

  it('omits Ver no Nexus when the Mini App URL is not configured', async () => {
    const s = setup({ miniAppUrl: null });
    await s.say(CHAT1, 'gastei 100 em roupa');
    await s.press(CHAT1, s.dataOf('Confirmar'));
    expect(s.labels(s.lastEdit().keyboard)).toEqual(['Desfazer']);
  });

  it('a double tap creates a single entry', async () => {
    const s = setup();
    await s.say(CHAT1, 'gastei 100 em roupa');
    const ok = s.dataOf('Confirmar');
    await Promise.all([s.press(CHAT1, ok), s.press(CHAT1, ok)]);
    expect(await s.fakes.finance.list(U1, {})).toHaveLength(1);
    expect(s.fakes.telegram.answers.map((a) => a.text)).toContain('Já anotado.');
  });

  it('the same Telegram update delivered twice is processed once', async () => {
    const s = setup();
    await s.say(CHAT1, 'gastei 100 em roupa');
    const update = { update_id: 900, callback_query: { id: 'x', data: s.dataOf('Confirmar'), message: { message_id: 5, chat: { id: CHAT1, type: 'private' } } } };
    await s.handle(update);
    await s.handle(update);
    expect(await s.fakes.finance.list(U1, {})).toHaveLength(1);
    expect(s.fakes.telegram.answers).toHaveLength(1);
  });

  it('Mudar categoria and Mudar data edit the proposal before anything is saved', async () => {
    const s = setup();
    await s.say(CHAT1, 'gastei 100 em roupa');
    await s.press(CHAT1, s.dataOf('Mudar categoria'));
    expect(s.lastEdit().text).toBe('Qual categoria?');
    expect(s.labels(s.lastEdit().keyboard)).toEqual(['Moradia', 'Mercado', 'Transporte', 'Lazer', 'Saúde', 'Roupas', 'Outra', 'Voltar']);
    await s.press(CHAT1, s.dataOf('Mercado'));
    expect(s.lastEdit().text).toBe('Anotei: R$ 100,00 em Mercado (roupa), hoje.');
    await s.press(CHAT1, s.dataOf('Mudar data'));
    expect(s.lastEdit().text).toBe('Foi quando?');
    expect(s.labels(s.lastEdit().keyboard)).toEqual(['Hoje', 'Ontem', 'Anteontem', 'Voltar']);
    await s.press(CHAT1, s.dataOf('Ontem'));
    expect(s.lastEdit().text).toBe('Anotei: R$ 100,00 em Mercado (roupa), ontem.');
    expect(await s.fakes.finance.list(U1, {})).toEqual([]);
    await s.press(CHAT1, s.dataOf('Confirmar'));
    expect(await s.fakes.finance.list(U1, {})).toMatchObject([{ category: 'Mercado', dueDate: '2026-10-25' }]);
  });

  it('Voltar returns to the proposal', async () => {
    const s = setup();
    await s.say(CHAT1, 'gastei 100 em roupa');
    await s.press(CHAT1, s.dataOf('Mudar data'));
    await s.press(CHAT1, s.dataOf('Voltar'));
    expect(s.lastEdit().text).toBe('Anotei: R$ 100,00 em Roupas, hoje.');
    expect(s.labels(s.lastEdit().keyboard)).toEqual(['Confirmar', 'Mudar categoria', 'Mudar data']);
  });

  it('Desfazer deletes what was created and a second Desfazer has nothing left to undo', async () => {
    const s = setup();
    await s.say(CHAT1, 'gastei 100 em roupa');
    await s.press(CHAT1, s.dataOf('Confirmar'));
    const undo = s.dataOf('Desfazer');
    await s.press(CHAT1, undo);
    expect(await s.fakes.finance.list(U1, {})).toEqual([]);
    expect(s.lastEdit().text).toBe('Desfeito. Apaguei: R$ 100,00 em Roupas, hoje.');
    expect(s.lastEdit().keyboard).toBeUndefined();
    await s.press(CHAT1, undo);
    expect(s.lastAnswer().text).toBe('Não há mais nada para desfazer.');
  });

  it('a failed creation puts the proposal back so the person can try again', async () => {
    const s = setup();
    await s.say(CHAT1, 'gastei 100 em roupa');
    const ok = s.dataOf('Confirmar');
    s.financeFail.next = true;
    await s.press(CHAT1, ok);
    expect(s.lastAnswer().text).toBe('Não consegui anotar agora. Nada foi salvo. Tente de novo.');
    expect(await s.fakes.finance.list(U1, {})).toEqual([]);
    await s.press(CHAT1, ok);
    expect(await s.fakes.finance.list(U1, {})).toHaveLength(1);
  });
});

describe('income and bills', () => {
  it('records an income as paid and keeps the freelance category', async () => {
    const s = setup();
    await s.say(CHAT1, 'recebi 1500 do freela');
    expect(s.lastSent().text).toBe('Anotei: entrada de R$ 1.500,00 em Freela, hoje.');
    await s.press(CHAT1, s.dataOf('Confirmar'));
    expect(await s.fakes.finance.list(U1, {})).toMatchObject([{ kind: 'entrada', amountCents: 150_000, status: 'paga', category: 'Freela' }]);
  });

  it('records a bill as a pagar with its due date and says reminders are not sent yet', async () => {
    const s = setup();
    await s.say(CHAT1, 'luz 187,40 vence dia 8');
    expect(s.lastSent().text).toBe('Anotei: conta de R$ 187,40 em Moradia (luz), vence 08/11.');
    await s.press(CHAT1, s.dataOf('Confirmar'));
    expect(await s.fakes.finance.list(U1, {})).toMatchObject([{ kind: 'conta', status: 'a_pagar', dueDate: '2026-11-08', paidAt: null }]);
    expect(s.lastEdit().text).toContain('o aviso pelo chat ainda não existe');
  });

  it('a bill without a date has no Confirmar until a day is chosen, and a forged tap is refused', async () => {
    const s = setup();
    await s.say(CHAT1, 'pagar luz 187,40');
    expect(s.lastSent().text).toBe('Anotei: conta de R$ 187,40 em Moradia (luz).\nQual o vencimento?');
    expect(buttonsOfLastSent(s)).not.toContain('Confirmar');
    const id = s.fakes.captures.all()[0]!.id;
    await s.press(CHAT1, `c:${id}:ok`);
    expect(s.lastAnswer().text).toBe('Escolha o dia antes de confirmar.');
    expect(await s.fakes.finance.list(U1, {})).toEqual([]);
    await s.press(CHAT1, s.dataOf('Mudar data'));
    expect(s.labels(s.lastEdit().keyboard)).toEqual(['Hoje', 'Amanhã', 'Depois de amanhã', 'Em 1 semana', 'Voltar']);
    await s.press(CHAT1, s.dataOf('Amanhã'));
    expect(s.lastEdit().text).toBe('Anotei: conta de R$ 187,40 em Moradia (luz), vence amanhã.');
    expect(s.labels(s.lastEdit().keyboard)).toContain('Confirmar');
  });
});

describe('task proposal', () => {
  it('ligar pra vidinha hoje 14h: shows the reminder rule and creates the task with its reminders on Confirmar', async () => {
    const s = setup();
    await s.say(CHAT1, 'ligar pra vidinha hoje 14h');
    expect(s.lastSent().text).toBe('Anotei: ligar pra vidinha, hoje às 14h.\nAviso: 15 min antes e na hora.');
    expect(buttonsOfLastSent(s)).toEqual(['Confirmar', 'Mudar dia', 'Mudar horário']);
    expect(await s.fakes.tasks.list(U1, {})).toEqual([]);
    await s.press(CHAT1, s.dataOf('Confirmar'));
    const [task] = await s.fakes.tasks.list(U1, {});
    expect(task).toMatchObject({ title: 'ligar pra vidinha', dueDate: '2026-10-26', dueTime: '14:00', status: 'pendente' });
    expect(s.lastEdit().text).toBe('Pronto, anotado. ligar pra vidinha, hoje às 14h.');
    expect(s.lastEdit().keyboard!.flat().find((b) => b.text === 'Ver no Nexus')).toMatchObject({ webAppUrl: `${MINI}/mini` });
    // O mesmo caminho do painel: os lembretes da tarefa foram gravados.
    expect(s.fakes.reminders.remindersFor(task!.id, U1).map((r) => r.kind)).toEqual(['antecipado', 'no_horario']);
  });

  it('a task without a date stays without a date and the bot asks; picking a day unlocks the time buttons', async () => {
    const s = setup();
    await s.say(CHAT1, 'ligar pra Ana');
    expect(s.lastSent().text).toBe('Anotei: ligar pra Ana, sem data.');
    expect(buttonsOfLastSent(s)).toEqual(['Confirmar', 'Mudar dia']);
    await s.press(CHAT1, s.dataOf('Mudar dia'));
    expect(s.lastEdit().text).toBe('Para qual dia?');
    await s.press(CHAT1, s.dataOf('Amanhã'));
    expect(s.lastEdit().text).toBe('Anotei: ligar pra Ana, amanhã.\nAviso: na véspera e no dia, às 8h.');
    expect(s.labels(s.lastEdit().keyboard)).toContain('Mudar horário');
    await s.press(CHAT1, s.dataOf('Mudar horário'));
    expect(s.labels(s.lastEdit().keyboard)).toEqual(['9h', '12h', '14h', '16h', '18h', 'Sem horário', 'Voltar']);
    await s.press(CHAT1, s.dataOf('16h'));
    expect(s.lastEdit().text).toBe('Anotei: ligar pra Ana, amanhã às 16h.\nAviso: 15 min antes e na hora.');
    await s.press(CHAT1, s.dataOf('Confirmar'));
    expect(await s.fakes.tasks.list(U1, {})).toMatchObject([{ dueDate: '2026-10-27', dueTime: '16:00' }]);
  });

  it('"de manhã" is not turned into a time: the bot says so', async () => {
    const s = setup();
    await s.say(CHAT1, 'ligar pro banco amanhã de manhã');
    expect(s.lastSent().text).toBe(
      'Anotei: ligar pro banco, amanhã.\nAviso: na véspera e no dia, às 8h.\nVocê não disse a hora: fica sem horário por enquanto.',
    );
  });
});

describe('who and when', () => {
  it('another user cannot press a button of this proposal', async () => {
    const s = setup();
    await s.say(CHAT1, 'gastei 100 em roupa');
    const ok = s.dataOf('Confirmar');
    await s.press(CHAT2, ok);
    expect(await s.fakes.finance.list(U1, {})).toEqual([]);
    expect(await s.fakes.finance.list(U2, {})).toEqual([]);
    expect(s.fakes.captures.all()[0]!.status).toBe('pendente');
    expect(s.logs.some((l) => l.event === 'telegram.capture_foreign')).toBe(true);
  });

  it('a proposal expires after one hour and the buttons say so', async () => {
    const s = setup();
    await s.say(CHAT1, 'gastei 100 em roupa');
    const ok = s.dataOf('Confirmar');
    s.fakes.setNow(new Date(NOW.getTime() + 61 * 60_000));
    await s.press(CHAT1, ok);
    expect(s.lastAnswer().text).toBe('Essa anotação expirou. Mande a mensagem de novo.');
    expect(await s.fakes.finance.list(U1, {})).toEqual([]);
  });

  it('Desfazer still works for 24 hours after confirming', async () => {
    const s = setup();
    await s.say(CHAT1, 'gastei 100 em roupa');
    await s.press(CHAT1, s.dataOf('Confirmar'));
    const undo = s.dataOf('Desfazer');
    s.fakes.setNow(new Date(NOW.getTime() + 23 * 60 * 60_000));
    await s.press(CHAT1, undo);
    expect(await s.fakes.finance.list(U1, {})).toEqual([]);
  });

  it('an old or malformed button is refused politely', async () => {
    const s = setup();
    await s.press(CHAT1, 'c:nao-e-um-id:ok');
    expect(s.lastAnswer().text).toBe('Esse botão é antigo. Mande a mensagem de novo.');
    await s.press(CHAT1, 'qualquer-coisa');
    expect(s.lastAnswer().text).toBe('Esse botão é antigo. Mande a mensagem de novo.');
    await s.press(CHAT1, 'c:00000000-0000-4000-8000-000000000099:ok');
    expect(s.lastAnswer().text).toBe('Essa anotação expirou. Mande a mensagem de novo.');
  });

  it('a button pressed from an unlinked chat asks to link first', async () => {
    const s = setup();
    await s.press(9999, 'c:00000000-0000-4000-8000-000000000001:ok');
    expect(s.lastAnswer().text).toBe('Vincule sua conta primeiro: gere um código no Nexus e envie /start CÓDIGO.');
  });

  it('an unlinked chat still gets the link instructions, never a proposal', async () => {
    const s = setup();
    await s.say(7777, 'gastei 100 em roupa');
    expect(s.lastSent().text).toContain('ainda não está vinculada');
    expect(s.fakes.captures.all()).toEqual([]);
  });
});

describe('what the rules do not understand', () => {
  it('without the assistant the bot answers with short help and does not call the model', async () => {
    const s = setup({ assistantEnabled: false });
    await s.say(CHAT1, 'oi');
    expect(s.lastSent().text).toBe('Não entendi. Tente: gastei 45 no mercado · recebi 800 de um serviço · reunião com a equipe sexta 9h30');
    expect(s.processMessage).not.toHaveBeenCalled();
    await s.say(CHAT1, 'gastei com mercado');
    expect(s.lastSent().text).toContain('Não entendi');
  });

  it('with the assistant configured, unknown text goes to it and a known pattern still does not', async () => {
    const s = setup({ assistantEnabled: true });
    await s.say(CHAT1, 'me explica como funciona o prazo em dobro');
    expect(s.processMessage).toHaveBeenCalledTimes(1);
    expect(s.lastSent().text).toBe('resposta do assistente');
    await s.say(CHAT1, 'gastei 100 em roupa');
    expect(s.processMessage).toHaveBeenCalledTimes(1);
    expect(s.lastSent().text).toBe('Anotei: R$ 100,00 em Roupas, hoje.');
  });

  it('/ajuda lists examples', async () => {
    const s = setup();
    await s.say(CHAT1, '/ajuda');
    expect(s.lastSent().text).toContain('gastei 45 no mercado');
    expect(s.lastSent().text).toContain('Nada é salvo antes de você tocar em Confirmar.');
  });

  it('keeps /start and /desvincular working', async () => {
    const s = setup();
    await s.say(CHAT1, '/start');
    expect(s.lastSent().text).toContain('/start CÓDIGO');
    await s.say(CHAT1, '/desvincular');
    expect(s.lastSent().text).toBe('Telegram desvinculado. Você não receberá mais lembretes por aqui.');
  });
});

describe('privacy', () => {
  it('never logs the message text, amounts, titles or chat ids', async () => {
    const s = setup();
    await s.say(CHAT1, 'gastei 123,45 em roupa SEGREDO');
    await s.press(CHAT1, s.dataOf('Confirmar'));
    s.financeFail.next = true;
    await s.say(CHAT1, 'ligar pra SEGREDO hoje 14h');
    const blob = JSON.stringify(s.logs);
    for (const secret of ['SEGREDO', '123,45', '12345', String(CHAT1)]) expect(blob).not.toContain(secret);
  });
});
