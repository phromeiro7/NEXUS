import type { AssistantReplyDto, TaskDto } from '@aj/shared';
import { describe, expect, it, vi } from 'vitest';
import { createFakes } from '../../../test/fakes.js';
import { newTask } from '../../../test/harness.js';
import { makeProcessMessage, type ProcessMessageInput } from '../assistant/process-message.js';
import { makeToolExecutor } from '../assistant/tools.js';
import { makeCalculateDeadline } from '../calculate-deadline.js';
import {
  AssistantUnavailableError,
  EventInProgressError,
  ForeignEventError,
  MessageTooLongError,
  RateLimitedError,
  TargetTasksGoneError,
} from '../errors.js';
import type { AssistantModel, ModelStep } from '../ports.js';
import { makeTaskUseCases } from '../tasks.js';
import { createFailedStartLimiter } from './failed-start-limiter.js';
import { makeHandleTelegramUpdate } from './webhook.js';

const NOW = new Date('2026-10-26T13:00:00Z');
const U1 = 'user-1';
const U2 = 'user-2';
const CHAT1 = 1001;
const CHAT2 = 2002;
const SECRET_TEXT = 'SEGREDO_DA_MENSAGEM_ZZ';
const SECRET_TITLE = 'TITULO_SECRETO_QQ';

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 };
const endTurn = (text: string): ModelStep => ({ stopReason: 'end_turn', blocks: [{ type: 'text', text }], usage });
const toolStep = (name: string, input: unknown): ModelStep => ({
  stopReason: 'tool_use',
  blocks: [{ type: 'tool_use', id: `t_${Math.random().toString(36).slice(2, 8)}`, name, input }],
  usage,
});

type Logs = Array<{ level: string; event: string; fields: Record<string, string | number | boolean | null> }>;

function setup(opts: { script?: Array<ModelStep | Error>; limiter?: boolean } = {}) {
  const fakes = createFakes({ now: NOW });
  const calculateDeadline = makeCalculateDeadline({ holidays: fakes.holidays });
  const tasks = makeTaskUseCases({
    tasks: fakes.tasks,
    cases: fakes.cases,
    profiles: fakes.profiles,
    reminders: fakes.reminders,
    calculateDeadline,
    clock: fakes.clock,
  });
  const script = [...(opts.script ?? [])];
  const modelCalls: Array<{ messages: unknown }> = [];
  const model: AssistantModel = {
    async step(input) {
      modelCalls.push({ messages: structuredClone(input.messages) });
      const next = script.shift();
      if (next === undefined) throw new Error('roteiro esgotado');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  const real = makeProcessMessage({
    model,
    executor: makeToolExecutor({ tasks, calculateDeadline, profiles: fakes.profiles, clock: fakes.clock }),
    chat: fakes.chat,
    events: fakes.inboundEvents,
    profiles: fakes.profiles,
    clock: fakes.clock,
    tasksByIds: async (userId, ids) => {
      const found = await Promise.all(ids.map((id) => fakes.tasks.get(userId, id)));
      return found.filter((t): t is TaskDto => t !== null);
    },
  });
  const processMessage = vi.fn<(i: ProcessMessageInput) => Promise<AssistantReplyDto>>(real);
  const logs: Logs = [];
  const logger = {
    info: (event: string, fields: Logs[number]['fields']) => logs.push({ level: 'info', event, fields }),
    error: (event: string, fields: Logs[number]['fields']) => logs.push({ level: 'error', event, fields }),
  };
  const limiter = createFailedStartLimiter({ max: 5, windowMs: 10 * 60_000 });
  const handle = makeHandleTelegramUpdate({
    links: fakes.links,
    events: fakes.inboundEvents,
    confirmations: fakes.confirmations,
    processMessage,
    telegram: fakes.telegram,
    clock: fakes.clock,
    logger,
    ...(opts.limiter === false ? {} : { failedStartLimiter: limiter }),
  });
  fakes.links.setChat(U1, CHAT1);
  let updateId = 1;
  const msg = (
    chatId: number,
    extra: Record<string, unknown>,
    over: { updateId?: number; type?: string; messageId?: number } = {},
  ) => ({
    update_id: over.updateId ?? updateId++,
    message: {
      message_id: over.messageId ?? 500 + updateId,
      date: 1,
      from: { id: 7, is_bot: false, first_name: 'X' },
      chat: { id: chatId, type: over.type ?? 'private', first_name: 'X' },
      ...extra,
    },
  });
  const sentTo = (chatId: number) => fakes.telegram.sent.filter((s) => s.chatId === chatId).map((s) => s.text);
  const code = async (userId: string) => {
    await fakes.links.create(userId, 'ABCD2345', new Date(NOW.getTime() + 600_000));
    return 'ABCD2345';
  };
  return { fakes, handle, processMessage, modelCalls, logs, limiter, msg, sentTo, code, tasks, script };
}

const INVALID = 'Código inválido ou vencido. Gere outro no painel.';
const UNLINKED = 'Esta conta ainda não está vinculada. Gere um código no painel (Configurações) e envie /start CÓDIGO.';
const LINKED =
  'Conta vinculada! Você receberá lembretes e o briefing do dia aqui. Se não foi você quem gerou o código no painel, envie /desvincular.';

describe('filtering', () => {
  it('ignores group, supergroup and channel chats without any reply or lookup', async () => {
    const s = setup();
    for (const type of ['group', 'supergroup', 'channel']) {
      await s.handle(s.msg(CHAT1, { text: 'oi' }, { type }));
    }
    expect(s.fakes.telegram.sent).toEqual([]);
    expect(s.processMessage).not.toHaveBeenCalled();
  });

  it('ignores edited_message, channel_post and callback_query updates', async () => {
    const s = setup();
    const m = s.msg(CHAT1, { text: 'oi' }).message;
    await s.handle({ update_id: 90, edited_message: m });
    await s.handle({ update_id: 91, channel_post: m });
    await s.handle({ update_id: 92, callback_query: { id: 'x', data: 'y' } });
    expect(s.fakes.telegram.sent).toEqual([]);
    expect(s.processMessage).not.toHaveBeenCalled();
  });

  it('ignores garbage and unexpected shapes without throwing', async () => {
    const s = setup();
    for (const bad of [null, 'x', 42, [], {}, { update_id: 'a' }, { update_id: 1, message: 'x' }, { update_id: 1, message: { chat: 1 } }]) {
      await expect(s.handle(bad)).resolves.toBeUndefined();
    }
    expect(s.fakes.telegram.sent).toEqual([]);
  });

  it('a photo gets the fixed text-only reply and no model call', async () => {
    const s = setup();
    await s.handle(s.msg(CHAT1, { photo: [{ file_id: 'f' }] }));
    expect(s.sentTo(CHAT1)).toEqual(['Por enquanto só entendo texto.']);
    expect(s.processMessage).not.toHaveBeenCalled();
  });

  it('audio, document and sticker also get the text-only reply (also from an unlinked chat)', async () => {
    const s = setup();
    await s.handle(s.msg(CHAT1, { voice: { file_id: 'a' } }));
    await s.handle(s.msg(CHAT1, { document: { file_id: 'd' } }));
    await s.handle(s.msg(CHAT2, { sticker: { file_id: 's' } }));
    expect(s.sentTo(CHAT1)).toEqual(['Por enquanto só entendo texto.', 'Por enquanto só entendo texto.']);
    expect(s.sentTo(CHAT2)).toEqual(['Por enquanto só entendo texto.']);
    expect(s.processMessage).not.toHaveBeenCalled();
  });
});

describe('unlinked chat', () => {
  it('only guides, never calls the model and creates nothing', async () => {
    const s = setup();
    await s.handle(s.msg(CHAT2, { text: 'reunião amanhã às 14h' }));
    expect(s.sentTo(CHAT2)).toEqual([UNLINKED]);
    expect(s.processMessage).not.toHaveBeenCalled();
    expect(await s.fakes.tasks.list(U1, {})).toEqual([]);
    expect(await s.fakes.tasks.list(U2, {})).toEqual([]);
  });

  it('a duplicate update_id from an unlinked chat has one effect', async () => {
    const s = setup();
    const u = s.msg(CHAT2, { text: 'oi' });
    await s.handle(u);
    await s.handle(u);
    expect(s.sentTo(CHAT2)).toEqual([UNLINKED]);
  });

  it('/start without a code gives the instructions', async () => {
    const s = setup();
    await s.handle(s.msg(CHAT2, { text: '/start' }));
    await s.handle(s.msg(CHAT2, { text: '/start   ' }));
    const text = 'Para vincular, gere um código no painel (Configurações) e envie /start CÓDIGO.';
    expect(s.sentTo(CHAT2)).toEqual([text, text]);
  });

  it('/desvincular from an unlinked chat gives the unlinked guidance', async () => {
    const s = setup();
    await s.handle(s.msg(CHAT2, { text: '/desvincular' }));
    expect(s.sentTo(CHAT2)).toEqual([UNLINKED]);
  });
});

describe('/start CODE', () => {
  it('a valid code links the chat and replies with the exact text', async () => {
    const s = setup();
    const c = await s.code(U2);
    await s.handle(s.msg(CHAT2, { text: `/start ${c}` }));
    expect(s.sentTo(CHAT2)).toEqual([LINKED]);
    expect(s.fakes.links.chatFor(U2)).toBe(CHAT2);
    expect(await s.fakes.links.userForChat(CHAT2)).toBe(U2);
  });

  it('the lowercase code and the /start@bot form work', async () => {
    const s = setup();
    const c = await s.code(U2);
    await s.handle(s.msg(CHAT2, { text: `/start@meu_bot ${c.toLowerCase()}` }));
    expect(s.sentTo(CHAT2)).toEqual([LINKED]);
  });

  it('reusing the same code answers invalid', async () => {
    const s = setup();
    const c = await s.code(U2);
    await s.handle(s.msg(CHAT2, { text: `/start ${c}` }));
    await s.handle(s.msg(3003, { text: `/start ${c}` }));
    expect(s.sentTo(3003)).toEqual([INVALID]);
    expect(s.fakes.links.chatFor(U2)).toBe(CHAT2);
  });

  it('an expired code answers invalid and links nothing', async () => {
    const s = setup();
    const c = await s.code(U2);
    s.fakes.setNow(new Date(NOW.getTime() + 601_000));
    await s.handle(s.msg(CHAT2, { text: `/start ${c}` }));
    expect(s.sentTo(CHAT2)).toEqual([INVALID]);
    expect(s.fakes.links.chatFor(U2)).toBeNull();
  });

  it('an unknown code answers invalid', async () => {
    const s = setup();
    await s.handle(s.msg(CHAT2, { text: '/start ZZZZ2222' }));
    expect(s.sentTo(CHAT2)).toEqual([INVALID]);
  });

  it('a malformed payload answers invalid WITHOUT looking the code up', async () => {
    const s = setup();
    const consume = vi.spyOn(s.fakes.links, 'consume');
    // 5 por chat (o limite de falhas); outro chat para a sexta forma.
    for (const p of ['ABC', 'ABCD23456', 'ABCD 234', 'ABCD-234', 'ÁBCD2345']) {
      await s.handle(s.msg(CHAT2, { text: `/start ${p}` }));
    }
    await s.handle(s.msg(3003, { text: '/start ABCD2345 extra' }));
    expect(consume).not.toHaveBeenCalled();
    expect(s.sentTo(CHAT2)).toEqual(Array(5).fill(INVALID));
    expect(s.sentTo(3003)).toEqual([INVALID]);
  });

  it('a chat already linked to another account answers chat_em_uso and the code stays valid', async () => {
    const s = setup();
    const c = await s.code(U2);
    await s.handle(s.msg(CHAT1, { text: `/start ${c}` }));
    expect(s.sentTo(CHAT1)).toEqual(['Este Telegram já está ligado a outra conta.']);
    expect(s.fakes.links.codesOf(U2)).toEqual([c]);
    expect(s.fakes.links.chatFor(U2)).toBeNull();
    // O mesmo código ainda vincula um chat livre.
    await s.handle(s.msg(CHAT2, { text: `/start ${c}` }));
    expect(s.sentTo(CHAT2)).toEqual([LINKED]);
  });

  it('a duplicate update_id has one effect (no "Código inválido" after a successful link)', async () => {
    const s = setup();
    const c = await s.code(U2);
    const u = s.msg(CHAT2, { text: `/start ${c}` });
    await s.handle(u);
    await s.handle(u);
    expect(s.sentTo(CHAT2)).toEqual([LINKED]);
  });

  it('the 6th failed attempt is blocked without a lookup; other chats are unaffected; the window expires', async () => {
    const s = setup();
    const consume = vi.spyOn(s.fakes.links, 'consume');
    for (let i = 0; i < 5; i++) await s.handle(s.msg(CHAT2, { text: '/start ZZZZ2222' }));
    expect(consume).toHaveBeenCalledTimes(5);
    const c = await s.code(U2);
    await s.handle(s.msg(CHAT2, { text: `/start ${c}` }));
    expect(consume).toHaveBeenCalledTimes(5);
    expect(s.sentTo(CHAT2).at(-1)).toBe('Muitas tentativas. Tente de novo em alguns minutos.');
    expect(s.fakes.links.chatFor(U2)).toBeNull();

    // Outro chat segue normal.
    await s.handle(s.msg(3003, { text: `/start ${c}` }));
    expect(s.sentTo(3003)).toEqual([LINKED]);

    // Depois da janela, o chat bloqueado volta a poder tentar.
    s.fakes.setNow(new Date(NOW.getTime() + 10 * 60_000 + 1));
    const c2 = 'WXYZ6789';
    await s.fakes.links.create(U1, c2, new Date(NOW.getTime() + 30 * 60_000));
    await s.handle(s.msg(CHAT2, { text: `/start ${c2}` }));
    expect(consume).toHaveBeenCalledTimes(7);
  });

  it('a malformed payload also counts as a failure', async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) await s.handle(s.msg(CHAT2, { text: '/start abc' }));
    await s.handle(s.msg(CHAT2, { text: '/start abc' }));
    expect(s.sentTo(CHAT2).at(-1)).toBe('Muitas tentativas. Tente de novo em alguns minutos.');
  });

  it('works without a limiter configured', async () => {
    const s = setup({ limiter: false });
    const c = await s.code(U2);
    await s.handle(s.msg(CHAT2, { text: `/start ${c}` }));
    expect(s.sentTo(CHAT2)).toEqual([LINKED]);
  });
});

describe('/desvincular', () => {
  it('unlinks a linked chat and replies', async () => {
    const s = setup();
    await s.handle(s.msg(CHAT1, { text: '/desvincular' }));
    expect(s.sentTo(CHAT1)).toEqual(['Telegram desvinculado. Você não receberá mais lembretes por aqui.']);
    expect(s.fakes.links.chatFor(U1)).toBeNull();
    expect(s.processMessage).not.toHaveBeenCalled();
  });

  it('also works as /desvincular@bot and is idempotent per update_id', async () => {
    const s = setup();
    const u = s.msg(CHAT1, { text: '/desvincular@meu_bot' });
    await s.handle(u);
    await s.handle(u);
    expect(s.sentTo(CHAT1)).toEqual(['Telegram desvinculado. Você não receberá mais lembretes por aqui.']);
    expect(s.fakes.links.chatFor(U1)).toBeNull();
  });

  it('only unlinks the chat owner', async () => {
    const s = setup();
    s.fakes.links.setChat(U2, CHAT2);
    await s.handle(s.msg(CHAT1, { text: '/desvincular' }));
    expect(s.fakes.links.chatFor(U2)).toBe(CHAT2);
  });
});

describe('model path', () => {
  it('creates a task, sends plain text with the task line and records the confirmation with the SENT message id', async () => {
    const s = setup({
      script: [
        toolStep('criar_tarefa', { title: 'Reunião', type: 'tarefa', dueDate: '2026-10-28', dueTime: '14:00' }),
        endTurn('Anotei.'),
      ],
    });
    s.fakes.telegram.script({ ok: true, messageId: 777 });
    const u = s.msg(CHAT1, { text: 'reunião quarta às 14h' });
    await s.handle(u);
    expect(s.processMessage).toHaveBeenCalledTimes(1);
    expect(s.processMessage.mock.calls[0]![0]).toEqual({
      userId: U1,
      channel: 'telegram',
      externalId: String(u.update_id),
      text: 'reunião quarta às 14h',
      source: 'telegram',
    });
    expect(s.sentTo(CHAT1)).toEqual(['Anotei.\n\n• Reunião — qua, 28/10, 14:00']);
    const [task] = await s.fakes.tasks.list(U1, {});
    expect((await s.fakes.confirmations.tasksFor(U1, CHAT1, 777)).alive).toEqual([task!.id]);
  });

  it('a reply without affected tasks records no confirmation', async () => {
    const s = setup({ script: [endTurn('Olá!')] });
    const record = vi.spyOn(s.fakes.confirmations, 'record');
    await s.handle(s.msg(CHAT1, { text: 'oi' }));
    expect(s.sentTo(CHAT1)).toEqual(['Olá!']);
    expect(record).not.toHaveBeenCalled();
  });

  it('a duplicate update_id replays the stored reply: no second task, no second model call', async () => {
    const s = setup({
      script: [toolStep('criar_tarefa', { title: 'Reunião', type: 'tarefa', dueDate: '2026-10-28' }), endTurn('Anotei.')],
    });
    const u = s.msg(CHAT1, { text: 'reunião quarta' });
    await s.handle(u);
    const callsAfterFirst = s.modelCalls.length;
    await s.handle(u);
    expect(s.modelCalls.length).toBe(callsAfterFirst);
    expect(await s.fakes.tasks.list(U1, {})).toHaveLength(1);
    const sent = s.sentTo(CHAT1);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
  });

  it('does not register the event itself for the model path (processMessage owns it)', async () => {
    const s = setup({ script: [endTurn('ok')] });
    const register = vi.spyOn(s.fakes.inboundEvents, 'register');
    await s.handle(s.msg(CHAT1, { text: 'oi' }));
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0]![0]).toBe(U1);
  });

  it('plain text only and within 4096 characters (no parse_mode in the client contract)', async () => {
    const s = setup({ script: [endTurn('*negrito* <b>x</b> ' + 'a'.repeat(900))] });
    await s.handle(s.msg(CHAT1, { text: 'oi' }));
    const [only] = s.fakes.telegram.sent;
    expect(only!.text.startsWith('*negrito* <b>x</b>')).toBe(true);
    expect(Array.from(only!.text).length).toBeLessThanOrEqual(4096);
    expect(Object.keys(only!)).toEqual(['chatId', 'text']);
  });

  it('a send failure after processing is logged by code only and does not throw or record', async () => {
    const s = setup({
      script: [toolStep('criar_tarefa', { title: SECRET_TITLE, type: 'tarefa', dueDate: '2026-10-28' }), endTurn(`Anotei ${SECRET_TEXT}`)],
    });
    const record = vi.spyOn(s.fakes.confirmations, 'record');
    s.fakes.telegram.failNext({ kind: 'permanent', reason: 'bot_bloqueado' });
    await expect(s.handle(s.msg(CHAT1, { text: SECRET_TEXT }))).resolves.toBeUndefined();
    expect(record).not.toHaveBeenCalled();
    expect(await s.fakes.tasks.list(U1, {})).toHaveLength(1);
    const logged = JSON.stringify(s.logs);
    expect(logged).toContain('bot_bloqueado');
    expect(logged).not.toContain(SECRET_TEXT);
    expect(logged).not.toContain(SECRET_TITLE);
  });
});

describe('reply to a confirmation', () => {
  async function created(s: ReturnType<typeof setup>) {
    s.script.push(
      toolStep('criar_tarefa', { title: 'Reunião', type: 'tarefa', dueDate: '2026-10-28', dueTime: '14:00' }),
      endTurn('Anotei.'),
    );
    s.fakes.telegram.script({ ok: true, messageId: 900 });
    await s.handle(s.msg(CHAT1, { text: 'reunião quarta 14h' }));
    const [task] = await s.fakes.tasks.list(U1, {});
    return task!;
  }

  it('a reply to a LIVE confirmation passes the task as targetTaskIds and alters THAT task', async () => {
    const s = setup();
    const task = await created(s);
    s.script.push(toolStep('alterar_tarefa', { id: task.id, dueTime: '15:00' }), endTurn('Mudei para 15h.'));
    await s.handle(s.msg(CHAT1, { text: 'muda para 15h', reply_to_message: { message_id: 900 } }));
    expect(s.processMessage.mock.calls.at(-1)![0].targetTaskIds).toEqual([task.id]);
    expect((await s.fakes.tasks.get(U1, task.id))!.dueTime).toBe('15:00');
  });

  it('a reply to a DELETED task says it no longer exists and does not call the model', async () => {
    const s = setup();
    const task = await created(s);
    await s.fakes.tasks.softDelete(U1, task.id, NOW);
    const before = s.processMessage.mock.calls.length;
    const u = s.msg(CHAT1, { text: 'muda para 15h', reply_to_message: { message_id: 900 } });
    await s.handle(u);
    expect(s.processMessage.mock.calls.length).toBe(before);
    expect(s.sentTo(CHAT1).at(-1)).toBe('Essa tarefa não existe mais.');
    // Idempotente por update_id.
    const sentBefore = s.sentTo(CHAT1).length;
    await s.handle(u);
    expect(s.sentTo(CHAT1)).toHaveLength(sentBefore);
  });

  it('a reply to a message that is not a recorded confirmation is a normal message without target', async () => {
    const s = setup({ script: [endTurn('ok')] });
    await s.handle(s.msg(CHAT1, { text: 'e isso?', reply_to_message: { message_id: 12345 } }));
    const input = s.processMessage.mock.calls[0]![0];
    expect(input.targetTaskIds).toBeUndefined();
    expect('targetTaskIds' in input).toBe(false);
  });

  it("another user's task never appears as a target", async () => {
    const s = setup({ script: [endTurn('ok')] });
    const theirs = await s.fakes.tasks.create(U2, newTask('Alheia'));
    await s.fakes.confirmations.record(CHAT1, 4242, [theirs.id]);
    await s.handle(s.msg(CHAT1, { text: 'apague', reply_to_message: { message_id: 4242 } }));
    expect(s.processMessage.mock.calls[0]![0].targetTaskIds).toBeUndefined();
    expect(JSON.stringify(s.modelCalls)).not.toContain('Alheia');
  });

  it('a reply in an unlinked chat only guides', async () => {
    const s = setup();
    await s.handle(s.msg(CHAT2, { text: 'oi', reply_to_message: { message_id: 900 } }));
    expect(s.sentTo(CHAT2)).toEqual([UNLINKED]);
    expect(s.processMessage).not.toHaveBeenCalled();
  });
});

describe('processMessage errors', () => {
  async function failWith(error: Error) {
    const s = setup();
    s.processMessage.mockRejectedValueOnce(error);
    await expect(s.handle(s.msg(CHAT1, { text: 'oi' }))).resolves.toBeUndefined();
    return s;
  }

  it('RateLimitedError', async () => {
    const s = await failWith(new RateLimitedError(60));
    expect(s.sentTo(CHAT1)).toEqual(['Limite de 30 mensagens por hora atingido.']);
  });

  it('MessageTooLongError', async () => {
    const s = await failWith(new MessageTooLongError(1000));
    expect(s.sentTo(CHAT1)).toEqual(['Sua mensagem é longa demais (limite de 1.000 caracteres).']);
  });

  it('AssistantUnavailableError', async () => {
    const s = await failWith(new AssistantUnavailableError('rede'));
    expect(s.sentTo(CHAT1)).toEqual(['O assistente está indisponível agora. Nada foi alterado.']);
  });

  it('EventInProgressError', async () => {
    const s = await failWith(new EventInProgressError());
    expect(s.sentTo(CHAT1)).toEqual(['Sua mensagem anterior ainda está sendo processada. Aguarde um instante.']);
  });

  it('ForeignEventError is silent and logs only the code', async () => {
    const s = await failWith(new ForeignEventError());
    expect(s.fakes.telegram.sent).toEqual([]);
    expect(s.logs).toHaveLength(1);
    expect(s.logs[0]!.level).toBe('error');
    expect(JSON.stringify(s.logs)).toContain('ForeignEventError');
  });

  it('TargetTasksGoneError', async () => {
    const s = await failWith(new TargetTasksGoneError());
    expect(s.sentTo(CHAT1)).toEqual(['Essa tarefa não existe mais.']);
  });

  it('an unknown error: no reply, logs only the error name', async () => {
    const s = await failWith(new TypeError(`falha com ${SECRET_TEXT}`));
    expect(s.fakes.telegram.sent).toEqual([]);
    const logged = JSON.stringify(s.logs);
    expect(logged).toContain('TypeError');
    expect(logged).not.toContain(SECRET_TEXT);
  });

  it('the real 1001-character message goes through processMessage and gets the too-long reply', async () => {
    const s = setup();
    await s.handle(s.msg(CHAT1, { text: 'a'.repeat(1001) }));
    expect(s.sentTo(CHAT1)).toEqual(['Sua mensagem é longa demais (limite de 1.000 caracteres).']);
    expect(s.modelCalls).toHaveLength(0);
  });
});

describe('logs never carry user text, titles or codes', () => {
  it('through every branch', async () => {
    const s = setup({ script: [endTurn(`resposta ${SECRET_TEXT}`)] });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = await s.code(U2);
    await s.handle(s.msg(CHAT1, { text: SECRET_TEXT }));
    await s.handle(s.msg(CHAT2, { text: SECRET_TEXT }));
    await s.handle(s.msg(CHAT2, { text: `/start ${c}` }));
    await s.handle(s.msg(CHAT2, { text: '/start BADCODE9' }));
    const all = JSON.stringify([s.logs, logSpy.mock.calls, errSpy.mock.calls]);
    expect(all).not.toContain(SECRET_TEXT);
    expect(all).not.toContain(c);
    expect(all).not.toContain('BADCODE9');
    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});
