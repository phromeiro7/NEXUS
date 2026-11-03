import { describe, expect, it, vi } from 'vitest';
import { newTask } from '../../test/harness.js';
import { createFakes } from '../../test/fakes.js';
import { renderReminder, retryDelayMs, type TelegramErrorClass } from '../domain/reminder-message.js';
import { ReminderLeaseError } from './errors.js';
import type { ReminderQueue, TelegramClient } from './ports.js';
import { makeRunReminders } from './run-reminders.js';

const NOW = new Date('2026-10-26T12:00:00Z');
const SECRET_TITLE = 'SEGREDO-Habeas-Corpus-9f3a';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

type Log = { level: 'info' | 'error'; event: string; fields: Record<string, unknown> };

function setup(opts: { telegram?: boolean } = {}) {
  const f = createFakes({ now: NOW });
  const events: string[] = [];
  const logs: Log[] = [];
  const logger = {
    info: (event: string, fields: Record<string, unknown>) => logs.push({ level: 'info', event, fields }),
    error: (event: string, fields: Record<string, unknown>) => logs.push({ level: 'error', event, fields }),
  };
  const sync = vi.fn(async (_u: string, _t: unknown, _p: unknown) => {
    events.push('sync');
  });
  let inFlight = 0;
  let maxInFlight = 0;
  let onSend: (chatId: number) => void | Promise<void> = () => {};
  const telegram: TelegramClient = {
    async sendMessage(chatId, text) {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      events.push('send');
      await Promise.resolve();
      await onSend(chatId);
      await new Promise((r) => setTimeout(r, 1));
      const res = await f.telegram.sendMessage(chatId, text);
      inFlight -= 1;
      return res;
    },
  };
  const origFinish = f.reminderQueue.finish.bind(f.reminderQueue);
  const finishSpy = vi.spyOn(f.reminderQueue, 'finish');
  finishSpy.mockImplementation(async (input, at) => {
    await origFinish(input, at);
    events.push(`finish:${input.status}`);
  });
  const pauseSpy = vi.spyOn(f.reminderQueue, 'pauseChannel');
  const claimSpy = vi.spyOn(f.reminderQueue, 'claimDue');
  const make = (
    over: { queue?: ReminderQueue; tasks?: typeof f.tasks; profiles?: typeof f.profiles } = {},
  ) =>
    makeRunReminders({
      queue: over.queue ?? f.reminderQueue,
      ...(opts.telegram === false ? {} : { telegram }),
      tasks: over.tasks ?? f.tasks,
      profiles: over.profiles ?? f.profiles,
      syncReminders: sync as never,
      clock: f.clock,
      logger,
    });
  const addTask = async (userId: string, p: Parameters<typeof newTask>[1] = {}, title = SECRET_TITLE) => {
    if (f.links.chatFor(userId) === null) f.links.setChat(userId, userId === 'u1' ? 111 : userId === 'u2' ? 222 : 333);
    return f.tasks.create(
      userId,
      newTask(title, { type: 'audiencia', dueDate: '2026-10-26', dueTime: '12:00', ...p }),
    );
  };
  const addReminder = async (
    userId: string,
    p: { task?: Parameters<typeof newTask>[1]; title?: string; scheduledAt?: Date; attempts?: number } = {},
  ) => {
    const t = await addTask(userId, p.task, p.title);
    const id = f.reminderQueue.seed({
      userId,
      taskId: t.id,
      scheduledAt: p.scheduledAt ?? NOW,
      attempts: p.attempts ?? 0,
    });
    return { task: t, id };
  };
  return {
    f,
    events,
    logs,
    sync,
    pauseSpy,
    claimSpy,
    finishSpy,
    make,
    addTask,
    addReminder,
    setOnSend: (fn: typeof onSend) => {
      onSend = fn;
    },
    maxInFlight: () => maxInFlight,
  };
}

const row = (s: ReturnType<typeof setup>, id: string) => s.f.reminderQueue.row(id)!;
const transient = (retryAfterMs?: number): TelegramErrorClass =>
  retryAfterMs === undefined ? { kind: 'transient' } : { kind: 'transient', retryAfterMs };

describe('runReminders', () => {
  it('envia, marca enviado e usa o texto de renderReminder; contadores exatos', async () => {
    const s = setup();
    const { id } = await s.addReminder('u1');
    const res = await s.make()();
    expect(res).toEqual({ sent: 1, retried: 0, failed: 0, cancelled: 0, recovered: 0, paused: 0, leaseLost: 0, deferred: 0 });
    expect(s.f.telegram.sent).toEqual([
      {
        chatId: 111,
        text: renderReminder({
          kind: 'no_horario',
          title: SECRET_TITLE,
          taskType: 'audiencia',
          dueDate: '2026-10-26',
          dueTime: '12:00',
          fatal: false,
          late: false,
        }),
      },
    ]);
    expect(row(s, id).status).toBe('enviado');
    expect(s.sync).not.toHaveBeenCalled();
  });

  it('dois irmãos vencidos de uma tarefa: um é enviado e o outro continua pendente (sem ressincronizar)', async () => {
    const s = setup();
    const { id, task } = await s.addReminder('u1');
    const sibling = s.f.reminderQueue.seed({
      userId: 'u1',
      taskId: task.id,
      kind: 'antecipado',
      scheduledAt: new Date(NOW.getTime() - 60_000),
    });
    await s.make()({ batchSize: 1, maxBatches: 1 });
    const statuses = [row(s, id).status, row(s, sibling).status].sort();
    expect(statuses).toEqual(['enviado', 'pendente']);
    expect(s.sync).not.toHaveBeenCalled();
  });

  it('atraso de 2 h: texto termina com " (atrasado)"', async () => {
    const s = setup();
    await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 2 * HOUR) });
    await s.make()();
    expect(s.f.telegram.sent).toHaveLength(1);
    expect(s.f.telegram.sent[0]!.text.endsWith(' (atrasado)')).toBe(true);
  });

  it('tarefa concluída entre a reserva e o envio: cancelado e sendMessage NÃO chamado', async () => {
    const s = setup();
    const { id, task } = await s.addReminder('u1');
    const q = s.f.reminderQueue;
    const queue: ReminderQueue = {
      ...q,
      claimDue: async (at, n) => {
        const c = await q.claimDue(at, n);
        await s.f.tasks.update('u1', task.id, { status: 'concluida' });
        return c;
      },
    };
    const res = await s.make({ queue })();
    expect(res.cancelled).toBe(1);
    expect(res.sent).toBe(0);
    expect(s.f.telegram.sent).toHaveLength(0);
    expect(row(s, id).status).toBe('cancelado');
    expect(row(s, id).lastError).toBe('tarefa_encerrada');
  });

  it('tarefa apagada entre a reserva e o envio: cancelado sem envio', async () => {
    const s = setup();
    const { id, task } = await s.addReminder('u1');
    const q = s.f.reminderQueue;
    const queue: ReminderQueue = {
      ...q,
      claimDue: async (at, n) => {
        const c = await q.claimDue(at, n);
        await s.f.tasks.softDelete('u1', task.id, at);
        return c;
      },
    };
    const res = await s.make({ queue })();
    expect(res.cancelled).toBe(1);
    expect(s.f.telegram.sent).toHaveLength(0);
    expect(row(s, id).status).toBe('cancelado');
    expect(s.sync).not.toHaveBeenCalled();
  });

  it('remarcada ANTES do envio: não envia, finish cancelado ANTES de syncReminders(tarefa fresca, perfil)', async () => {
    const s = setup();
    const { id, task } = await s.addReminder('u1');
    const q = s.f.reminderQueue;
    const queue: ReminderQueue = {
      ...q,
      claimDue: async (at, n) => {
        const c = await q.claimDue(at, n);
        await s.f.tasks.update('u1', task.id, { dueTime: '15:30' });
        return c;
      },
    };
    const res = await s.make({ queue })();
    expect(res).toMatchObject({ sent: 0, cancelled: 1 });
    expect(s.f.telegram.sent).toHaveLength(0);
    expect(row(s, id).status).toBe('cancelado');
    expect(row(s, id).lastError).toBe('remarcada');
    expect(s.events).toEqual(['finish:cancelado', 'sync']);
    expect(s.sync).toHaveBeenCalledTimes(1);
    const [uid, t, profile] = s.sync.mock.calls[0]!;
    expect(uid).toBe('u1');
    expect(t).toMatchObject({ id: task.id, dueTime: '15:30' });
    expect(profile).toEqual(await s.f.profiles.get('u1'));
  });

  it('remarcada DURANTE o envio: envia, finish enviado e depois syncReminders', async () => {
    const s = setup();
    const { id, task } = await s.addReminder('u1');
    s.setOnSend(async () => {
      await s.f.tasks.update('u1', task.id, { fatal: true });
    });
    const res = await s.make()();
    expect(res).toMatchObject({ sent: 1, cancelled: 0 });
    expect(row(s, id).status).toBe('enviado');
    expect(s.events).toEqual(['send', 'finish:enviado', 'sync']);
    expect(s.sync.mock.calls[0]![1]).toMatchObject({ id: task.id, fatal: true });
  });

  it('concluída DURANTE o envio: enviado e nada a refazer', async () => {
    const s = setup();
    const { id, task } = await s.addReminder('u1');
    s.setOnSend(async () => {
      await s.f.tasks.update('u1', task.id, { status: 'concluida' });
    });
    const res = await s.make()();
    expect(res.sent).toBe(1);
    expect(row(s, id).status).toBe('enviado');
    expect(s.sync).not.toHaveBeenCalled();
  });

  it('403: falhou + pauseChannel do usuário, demais do usuário devolvidos sem envio, outros usuários enviados', async () => {
    const s = setup();
    const a1 = await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 3 * MIN) });
    const b1 = await s.addReminder('u2', { scheduledAt: new Date(NOW.getTime() - 2 * MIN) });
    const a2 = await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 1 * MIN) });
    s.f.telegram.failNext({ kind: 'permanent', reason: 'bot_bloqueado' });
    const res = await s.make()();
    expect(res).toEqual({ sent: 1, retried: 0, failed: 1, cancelled: 0, recovered: 0, paused: 1, leaseLost: 0, deferred: 0 });
    expect(s.pauseSpy.mock.calls).toEqual([['u1']]);
    expect(s.f.telegram.sent.map((m) => m.chatId)).toEqual([111, 222]);
    expect(row(s, a1.id)).toMatchObject({ status: 'falhou', lastError: 'bot_bloqueado' });
    expect(row(s, a2.id)).toMatchObject({ status: 'pendente', lastError: 'canal_pausado' });
    expect(row(s, a2.id).nextAttemptAt).toEqual(NOW);
    expect(row(s, b1.id).status).toBe('enviado');
  });

  it('chat_inexistente também pausa o canal', async () => {
    const s = setup();
    const a = await s.addReminder('u1');
    s.f.telegram.failNext({ kind: 'permanent', reason: 'chat_inexistente' });
    const res = await s.make()();
    expect(res).toMatchObject({ failed: 1, paused: 1 });
    expect(row(s, a.id)).toMatchObject({ status: 'falhou', lastError: 'chat_inexistente' });
    expect(s.pauseSpy).toHaveBeenCalledWith('u1');
  });

  it("permanente 'outro' (401/400): falhou e NÃO pausa; os demais do usuário seguem sendo enviados", async () => {
    const s = setup();
    const a1 = await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 2 * MIN) });
    const a2 = await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 1 * MIN) });
    s.f.telegram.failNext({ kind: 'permanent', reason: 'outro' });
    const res = await s.make()();
    expect(res).toEqual({ sent: 1, retried: 0, failed: 1, cancelled: 0, recovered: 0, paused: 0, leaseLost: 0, deferred: 0 });
    expect(s.pauseSpy).not.toHaveBeenCalled();
    expect(row(s, a1.id)).toMatchObject({ status: 'falhou', lastError: 'outro' });
    expect(row(s, a2.id).status).toBe('enviado');
    expect(s.f.telegram.sent).toHaveLength(2);
  });

  it('paused conta uma vez por usuário por execução', async () => {
    const s = setup();
    await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 3 * MIN) });
    await s.addReminder('u2', { scheduledAt: new Date(NOW.getTime() - 2 * MIN) });
    s.f.telegram.script(
      { ok: false, error: { kind: 'permanent', reason: 'bot_bloqueado' } },
      { ok: false, error: { kind: 'permanent', reason: 'bot_bloqueado' } },
    );
    const res = await s.make()();
    expect(res).toMatchObject({ failed: 2, paused: 2 });
    expect(s.pauseSpy.mock.calls).toEqual([['u1'], ['u2']]);
  });

  it('429 retry_after 120 s: pendente com próxima tentativa >= now+120 s', async () => {
    const s = setup();
    const { id } = await s.addReminder('u1');
    s.f.telegram.failNext(transient(120_000));
    const res = await s.make()();
    expect(res).toMatchObject({ retried: 1, failed: 0, sent: 0 });
    expect(row(s, id).status).toBe('pendente');
    expect(row(s, id).lastError).toBe('transitorio');
    expect(row(s, id).nextAttemptAt).toEqual(new Date(NOW.getTime() + 120_000));
  });

  it('429 retry_after 10^9 s: limitado a 24 h', async () => {
    const s = setup();
    const { id } = await s.addReminder('u1');
    s.f.telegram.failNext(transient(1e9 * 1000));
    await s.make()();
    expect(row(s, id).nextAttemptAt).toEqual(new Date(NOW.getTime() + DAY));
  });

  it.each([1, 2, 3, 4])('transitório na tentativa %i: retry com o recuo de retryDelayMs', async (attempts) => {
    const s = setup();
    const { id } = await s.addReminder('u1', { attempts: attempts - 1 });
    s.f.telegram.failNext(transient());
    const res = await s.make()();
    expect(res).toMatchObject({ retried: 1, failed: 0 });
    expect(row(s, id).status).toBe('pendente');
    expect(row(s, id).nextAttemptAt).toEqual(new Date(NOW.getTime() + retryDelayMs(attempts)!));
  });

  it('transitório na 5ª tentativa: falhou', async () => {
    const s = setup();
    const { id } = await s.addReminder('u1', { attempts: 4 });
    s.f.telegram.failNext(transient());
    const res = await s.make()();
    expect(res).toMatchObject({ retried: 0, failed: 1 });
    expect(row(s, id)).toMatchObject({ status: 'falhou', lastError: 'tentativas_esgotadas' });
  });

  it('retry_after curto não reduz o recuo mínimo', async () => {
    const s = setup();
    const { id } = await s.addReminder('u1');
    s.f.telegram.failNext(transient(1000));
    await s.make()();
    expect(row(s, id).nextAttemptAt).toEqual(new Date(NOW.getTime() + 60_000));
  });

  it('attempts 6 numa linha reservada: falhou sem enviar', async () => {
    const s = setup();
    const { id } = await s.addReminder('u1', { attempts: 5 });
    const res = await s.make()();
    expect(res).toMatchObject({ failed: 1, sent: 0 });
    expect(s.f.telegram.sent).toHaveLength(0);
    expect(row(s, id)).toMatchObject({ status: 'falhou', lastError: 'tentativas_esgotadas' });
  });

  describe.each([
    ['lembrete_inexistente'],
    ['lembrete_reservado_por_outro'],
    ['lembrete_em_estado_invalido'],
  ] as const)('ReminderLeaseError %s em finish', (code) => {
    it('conta leaseLost e o lote continua', async () => {
      const s = setup();
      const a = await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 2 * MIN) });
      const b = await s.addReminder('u2', { scheduledAt: new Date(NOW.getTime() - 1 * MIN) });
      const q = s.f.reminderQueue;
      const queue: ReminderQueue = {
        ...q,
        finish: async (input, at) => {
          if (input.reminderId === a.id) throw new ReminderLeaseError(code);
          return q.finish(input, at);
        },
      };
      const res = await s.make({ queue })();
      expect(res).toEqual({ sent: 1, retried: 0, failed: 0, cancelled: 0, recovered: 0, paused: 0, leaseLost: 1, deferred: 0 });
      expect(row(s, b.id).status).toBe('enviado');
      expect(s.logs).toContainEqual(expect.objectContaining({ event: 'reminder.lease_lost', fields: { reminderId: a.id, code } }));
    });
  });

  it('exceção inesperada num lembrete: log só do nome; os próximos seguem', async () => {
    const s = setup();
    const a = await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 2 * MIN) });
    const b = await s.addReminder('u2', { scheduledAt: new Date(NOW.getTime() - 1 * MIN) });
    const realGet = s.f.tasks.get.bind(s.f.tasks);
    const tasks = {
      ...s.f.tasks,
      get: async (u: string, id: string) => {
        if (u === 'u1') throw new TypeError(`falha ${SECRET_TITLE}`);
        return realGet(u, id);
      },
    };
    const run = makeRunReminders({
      queue: s.f.reminderQueue,
      telegram: s.f.telegram,
      tasks,
      profiles: s.f.profiles,
      syncReminders: s.sync as never,
      clock: s.f.clock,
      logger: {
        info: (event, fields) => s.logs.push({ level: 'info', event, fields }),
        error: (event, fields) => s.logs.push({ level: 'error', event, fields }),
      },
    });
    const res = await run();
    expect(res.sent).toBe(1);
    expect(row(s, a.id).status).toBe('enviando');
    expect(row(s, b.id).status).toBe('enviado');
    expect(s.logs).toContainEqual({
      level: 'error',
      event: 'reminder.unexpected_error',
      fields: { reminderId: a.id, errorName: 'TypeError' },
    });
  });

  describe('re-sincroniza depois de QUALQUER desfecho (I1)', () => {
    const outcomes: Array<{
      name: string;
      attempts: number;
      script: TelegramErrorClass | null;
      status: string;
      sends: number;
      rescheduleBeforeSend?: boolean;
    }> = [
      { name: 'enviado', attempts: 0, script: null, status: 'enviado', sends: 1 },
      { name: 'transitório (retry)', attempts: 0, script: { kind: 'transient' }, status: 'pendente', sends: 1 },
      { name: 'transitório esgotado', attempts: 4, script: { kind: 'transient' }, status: 'falhou', sends: 1 },
      { name: 'permanente outro', attempts: 0, script: { kind: 'permanent', reason: 'outro' }, status: 'falhou', sends: 1 },
      {
        name: 'permanente bot_bloqueado',
        attempts: 0,
        script: { kind: 'permanent', reason: 'bot_bloqueado' },
        status: 'falhou',
        sends: 1,
      },
      { name: 'attempts > 5', attempts: 5, script: null, status: 'falhou', sends: 0, rescheduleBeforeSend: true },
    ];

    it.each(outcomes)('$name + remarcação: finish antes de syncReminders', async (o) => {
      const s = setup();
      const { id, task } = await s.addReminder('u1', { attempts: o.attempts });
      if (o.script !== null) s.f.telegram.failNext(o.script);
      const reschedule = () => s.f.tasks.update('u1', task.id, { dueTime: '15:30' });
      let queue: ReminderQueue = s.f.reminderQueue;
      if (o.rescheduleBeforeSend === true) {
        const q = s.f.reminderQueue;
        queue = {
          ...q,
          claimDue: async (at, n) => {
            const c = await q.claimDue(at, n);
            await reschedule();
            return c;
          },
        };
      } else {
        s.setOnSend(async () => {
          await reschedule();
        });
      }
      await s.make({ queue })();
      expect(row(s, id).status).toBe(o.status);
      expect(s.f.telegram.sent).toHaveLength(o.sends);
      expect(s.sync).toHaveBeenCalledTimes(1);
      expect(s.sync.mock.calls[0]![1]).toMatchObject({ id: task.id, dueTime: '15:30' });
      const events = s.events.filter((e) => e !== 'send');
      expect(events[0]).toBe(`finish:${o.status}`);
      expect(events[1]).toBe('sync');
    });

    it.each(outcomes)('$name sem mudança: syncReminders NÃO chamado', async (o) => {
      const s = setup();
      const { id } = await s.addReminder('u1', { attempts: o.attempts });
      if (o.script !== null) s.f.telegram.failNext(o.script);
      await s.make()();
      expect(row(s, id).status).toBe(o.status);
      expect(s.sync).not.toHaveBeenCalled();
    });

    it('transitório + tarefa concluída durante o envio: nada a refazer', async () => {
      const s = setup();
      const { id, task } = await s.addReminder('u1');
      s.f.telegram.failNext({ kind: 'transient' });
      s.setOnSend(async () => {
        await s.f.tasks.update('u1', task.id, { status: 'concluida' });
      });
      await s.make()();
      expect(row(s, id).status).toBe('pendente');
      expect(s.sync).not.toHaveBeenCalled();
    });
  });

  describe('resync é best-effort (round 2)', () => {
    type Break = 'sync' | 'profiles' | 'tasks';
    const breaks: Break[] = ['sync', 'profiles', 'tasks'];

    /** Remarca durante o envio e, a partir daí, quebra a etapa pedida da ressincronização. */
    const arm = async (s: ReturnType<typeof setup>, which: Break, taskId: string) => {
      let broken = false;
      s.setOnSend(async () => {
        await s.f.tasks.update('u1', taskId, { dueTime: '15:30' });
        broken = true;
      });
      s.sync.mockImplementation(async () => {
        if (which === 'sync') throw new RangeError(`sync ${SECRET_TITLE}`);
      });
      const tasks = {
        ...s.f.tasks,
        get: async (u: string, id: string) => {
          if (broken && which === 'tasks' && id === taskId) throw new EvalError(`get ${SECRET_TITLE}`);
          return s.f.tasks.get(u, id);
        },
      };
      const profiles = {
        ...s.f.profiles,
        get: async (u: string) => {
          if (which === 'profiles') throw new SyntaxError(`profile ${SECRET_TITLE}`);
          return s.f.profiles.get(u);
        },
      };
      return { tasks, profiles };
    };
    const NAMES: Record<Break, string> = { sync: 'RangeError', profiles: 'SyntaxError', tasks: 'EvalError' };

    const expectResyncLogged = (s: ReturnType<typeof setup>, reminderId: string, which: Break) => {
      expect(s.logs).toContainEqual({
        level: 'error',
        event: 'reminder.resync_failed',
        fields: { reminderId, errorName: NAMES[which] },
      });
      expect(JSON.stringify(s.logs)).not.toContain('SEGREDO');
      expect(s.logs.some((l) => l.event === 'reminder.unexpected_error')).toBe(false);
    };

    it.each(breaks)('403 + remarcação + %s lança: canal pausado, irmãos devolvidos, falhou contado uma vez', async (which) => {
      const s = setup();
      const a1 = await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 3 * MIN) });
      const b1 = await s.addReminder('u2', { scheduledAt: new Date(NOW.getTime() - 2 * MIN) });
      const a2 = await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 1 * MIN) });
      s.f.telegram.failNext({ kind: 'permanent', reason: 'bot_bloqueado' });
      const over = await arm(s, which, a1.task.id);
      const res = await s.make(over)();
      expect(res).toEqual({ sent: 1, retried: 0, failed: 1, cancelled: 0, recovered: 0, paused: 1, leaseLost: 0, deferred: 0 });
      expect(s.pauseSpy.mock.calls).toEqual([['u1']]);
      expect(row(s, a1.id).status).toBe('falhou');
      expect(row(s, a2.id)).toMatchObject({ status: 'pendente', lastError: 'canal_pausado' });
      expect(row(s, b1.id).status).toBe('enviado');
      expect(s.f.telegram.sent.map((m) => m.chatId)).toEqual([111, 222]);
      expectResyncLogged(s, a1.id, which);
    });

    it.each(breaks)('transitório + remarcação + %s lança: retry registrado e o lote continua', async (which) => {
      const s = setup();
      const a = await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 2 * MIN) });
      const b = await s.addReminder('u2', { scheduledAt: new Date(NOW.getTime() - 1 * MIN) });
      s.f.telegram.failNext({ kind: 'transient' });
      const over = await arm(s, which, a.task.id);
      const res = await s.make(over)();
      expect(res).toMatchObject({ sent: 1, retried: 1, failed: 0 });
      expect(row(s, a.id).status).toBe('pendente');
      expect(row(s, b.id).status).toBe('enviado');
      expectResyncLogged(s, a.id, which);
    });

    it.each(breaks)('enviado + remarcação + %s lança: enviado contado e o lote continua', async (which) => {
      const s = setup();
      const a = await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 2 * MIN) });
      const b = await s.addReminder('u2', { scheduledAt: new Date(NOW.getTime() - 1 * MIN) });
      const over = await arm(s, which, a.task.id);
      const res = await s.make(over)();
      expect(res).toMatchObject({ sent: 2, leaseLost: 0 });
      expect(row(s, a.id).status).toBe('enviado');
      expect(row(s, b.id).status).toBe('enviado');
      expectResyncLogged(s, a.id, which);
    });

    it('remarcada antes do envio e syncReminders lança: cancelado contado, lote continua, log distinto', async () => {
      const s = setup();
      const a = await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 2 * MIN) });
      const b = await s.addReminder('u2', { scheduledAt: new Date(NOW.getTime() - 1 * MIN) });
      s.sync.mockImplementation(async () => {
        throw new RangeError(SECRET_TITLE);
      });
      const q = s.f.reminderQueue;
      const queue: ReminderQueue = {
        ...q,
        claimDue: async (at, n) => {
          const c = await q.claimDue(at, n);
          await s.f.tasks.update('u1', a.task.id, { dueTime: '15:30' });
          return c;
        },
      };
      const res = await s.make({ queue })();
      expect(res).toMatchObject({ sent: 1, cancelled: 1 });
      expect(row(s, a.id)).toMatchObject({ status: 'cancelado', lastError: 'remarcada' });
      expectResyncLogged(s, a.id, 'sync');
    });
  });

  it('data removida depois da reserva: cancelado (sem_data), sem envio, syncReminders chamado', async () => {
    const s = setup();
    const { id, task } = await s.addReminder('u1');
    const q = s.f.reminderQueue;
    const queue: ReminderQueue = {
      ...q,
      claimDue: async (at, n) => {
        const c = await q.claimDue(at, n);
        await s.f.tasks.update('u1', task.id, { dueDate: null, dueTime: null });
        return c;
      },
    };
    const res = await s.make({ queue })();
    expect(res).toMatchObject({ sent: 0, cancelled: 1, failed: 0 });
    expect(s.f.telegram.sent).toHaveLength(0);
    expect(row(s, id)).toMatchObject({ status: 'cancelado', lastError: 'sem_data' });
    expect(s.events).toEqual(['finish:cancelado', 'sync']);
    expect(s.sync.mock.calls[0]![1]).toMatchObject({ id: task.id, dueDate: null });
  });

  it('orçamento de tempo: excedido, o resto do lote volta a pendente sem envio e nenhum lote novo é reservado', async () => {
    const s = setup();
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const u = ['u1', 'u2', 'u3', 'u1'][i]!;
      ids.push((await s.addReminder(u, { scheduledAt: new Date(NOW.getTime() - (10 - i) * MIN) })).id);
    }
    s.setOnSend(() => {
      s.f.setNow(new Date(s.f.clock.now().getTime() + 6_000));
    });
    const res = await s.make()({ budgetMs: 10_000, batchSize: 3 });
    expect(res).toEqual({
      sent: 2,
      retried: 0,
      failed: 0,
      cancelled: 0,
      recovered: 0,
      paused: 0,
      leaseLost: 0,
      deferred: 1,
    });
    expect(s.f.telegram.sent).toHaveLength(2);
    expect(row(s, ids[2]!)).toMatchObject({ status: 'pendente', lastError: 'orcamento_de_tempo' });
    expect(row(s, ids[2]!).nextAttemptAt).toEqual(new Date(NOW.getTime() + 12_000));
    expect(row(s, ids[3]!).status).toBe('pendente');
    expect(row(s, ids[3]!).attempts).toBe(0);
    expect(s.claimSpy).toHaveBeenCalledTimes(1);
  });

  it('orçamento padrão de 25 s: execução rápida não adia nada', async () => {
    const s = setup();
    await s.addReminder('u1');
    const res = await s.make()();
    expect(res).toMatchObject({ sent: 1, deferred: 0 });
  });

  it('finish(enviado) falha depois do envio: evento reminder.sent_unrecorded com o código/nome, sem texto', async () => {
    const s = setup();
    const a = await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 2 * MIN) });
    const b = await s.addReminder('u2', { scheduledAt: new Date(NOW.getTime() - 1 * MIN) });
    const q = s.f.reminderQueue;
    const queue: ReminderQueue = {
      ...q,
      finish: async (input, at) => {
        if (input.status === 'enviado' && input.reminderId === a.id) {
          throw new ReminderLeaseError('lembrete_reservado_por_outro');
        }
        if (input.status === 'enviado' && input.reminderId === b.id) throw new TypeError(SECRET_TITLE);
        return q.finish(input, at);
      },
    };
    const res = await s.make({ queue })();
    expect(res).toMatchObject({ sent: 0, leaseLost: 1 });
    expect(s.logs).toContainEqual({
      level: 'error',
      event: 'reminder.sent_unrecorded',
      fields: { reminderId: a.id, error: 'lembrete_reservado_por_outro' },
    });
    expect(s.logs).toContainEqual({
      level: 'error',
      event: 'reminder.sent_unrecorded',
      fields: { reminderId: b.id, error: 'TypeError' },
    });
    expect(JSON.stringify(s.logs)).not.toContain('SEGREDO');
  });

  it('sem Telegram: recoverStuck e cancelDead rodam, claimDue NUNCA', async () => {
    const s = setup({ telegram: false });
    const stuck = s.f.reminderQueue.seed({
      userId: 'u1',
      taskId: (await s.addTask('u1')).id,
      scheduledAt: new Date(NOW.getTime() - HOUR),
      status: 'enviando',
      attempts: 1,
      lockedAt: new Date(NOW.getTime() - 10 * MIN),
    });
    const dead = await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 2 * DAY) });
    const fresh = await s.addReminder('u1');
    const res = await s.make()();
    expect(res).toEqual({ sent: 0, retried: 0, failed: 0, cancelled: 1, recovered: 1, paused: 0, leaseLost: 0, deferred: 0 });
    expect(s.claimSpy).not.toHaveBeenCalled();
    expect(row(s, stuck).status).toBe('pendente');
    expect(row(s, dead.id).status).toBe('cancelado');
    expect(row(s, fresh.id)).toMatchObject({ status: 'pendente', attempts: 0 });
  });

  it('recuperados e cancelados entram nos contadores junto com os enviados', async () => {
    const s = setup();
    s.f.reminderQueue.seed({
      userId: 'u1',
      taskId: (await s.addTask('u1')).id,
      scheduledAt: new Date(NOW.getTime() - 30 * MIN),
      status: 'enviando',
      attempts: 1,
      lockedAt: new Date(NOW.getTime() - 10 * MIN),
    });
    await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 2 * DAY) });
    const res = await s.make()();
    expect(res).toEqual({ sent: 1, retried: 0, failed: 0, cancelled: 1, recovered: 1, paused: 0, leaseLost: 0, deferred: 0 });
  });

  it('envio estritamente sequencial: nunca duas sendMessage sobrepostas', async () => {
    const s = setup();
    for (let i = 0; i < 4; i += 1) {
      await s.addReminder(i % 2 === 0 ? 'u1' : 'u2', { scheduledAt: new Date(NOW.getTime() - (10 - i) * MIN) });
    }
    const res = await s.make()();
    expect(res.sent).toBe(4);
    expect(s.maxInFlight()).toBe(1);
    expect(s.f.telegram.sent.map((m) => m.chatId)).toEqual([111, 222, 111, 222]);
  });

  it('batchSize e maxBatches respeitados', async () => {
    const s = setup();
    for (let i = 0; i < 7; i += 1) {
      await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - (10 - i) * MIN) });
    }
    const res = await s.make()({ maxBatches: 2, batchSize: 3 });
    expect(res.sent).toBe(6);
    expect(s.claimSpy.mock.calls.map((c) => c[1])).toEqual([3, 3]);
    // padrão: sem lembretes vencidos restantes, um lote vazio encerra o laço
    const res2 = await s.make()();
    expect(res2.sent).toBe(1);
    expect(s.claimSpy.mock.calls.at(-1)![1]).toBe(20);
    expect(s.claimSpy).toHaveBeenCalledTimes(4);
  });

  it('padrão de 5 lotes', async () => {
    const s = setup();
    for (let i = 0; i < 7; i += 1) await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - (10 - i) * MIN) });
    const res = await s.make()({ batchSize: 1 });
    expect(res.sent).toBe(5);
    expect(s.claimSpy).toHaveBeenCalledTimes(5);
  });

  it('logs nunca recebem título nem texto do lembrete', async () => {
    const s = setup();
    const spy = vi.spyOn(console, 'log');
    const spyErr = vi.spyOn(console, 'error');
    await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 3 * MIN) });
    await s.addReminder('u1', { scheduledAt: new Date(NOW.getTime() - 2 * MIN) });
    await s.addReminder('u2', { scheduledAt: new Date(NOW.getTime() - 1 * MIN) });
    s.f.telegram.failNext({ kind: 'permanent', reason: 'bot_bloqueado' });
    await s.make()();
    await s.addReminder('u2');
    s.f.telegram.failNext(transient(5000));
    await s.make()();
    expect(s.logs.length).toBeGreaterThan(0);
    const dump = JSON.stringify([s.logs, spy.mock.calls, spyErr.mock.calls]);
    expect(dump).not.toContain('SEGREDO');
    expect(dump).not.toContain('Habeas');
    expect(dump).not.toContain('hoje');
    for (const l of s.logs) {
      for (const v of Object.values(l.fields)) expect(['string', 'number', 'boolean'].includes(typeof v) || v === null).toBe(true);
      expect(Object.keys(l.fields)).not.toContain('chatId');
    }
    spy.mockRestore();
    spyErr.mockRestore();
  });
});
