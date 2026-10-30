import { renderBriefing, type BriefingDto, type IsoDate } from '@aj/shared';
import { describe, expect, it, vi } from 'vitest';
import { createFakes } from '../../../test/fakes.js';
import type { TelegramErrorClass } from '../../domain/reminder-message.js';
import type { BriefingRepository, TelegramClient } from '../ports.js';
import { makeSendDailyBriefings } from './briefing-sender.js';

const SECRET = 'SEGREDO-Habeas-Corpus-9f3a';
const d = (s: string) => s as IsoDate;
// 11:00Z = 08:00 em America/Sao_Paulo (UTC-3)
const AT_0800 = new Date('2026-10-26T11:00:00Z');
const ZERO = { sent: 0, skippedEmpty: 0, retried: 0, failed: 0, paused: 0, deferred: 0 };

type Log = { level: 'info' | 'error'; event: string; fields: Record<string, unknown> };

const dto = (today = '2026-10-26', title = SECRET): BriefingDto => {
  const t = {
    id: 't1',
    caseId: null,
    title,
    type: 'tarefa',
    status: 'pendente',
    dueDate: today,
    dueTime: '10:00',
    fatal: true,
    baseDate: null,
    periodDays: null,
    countType: null,
    completedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  } as unknown as BriefingDto['fatalToday'][number];
  return { today: d(today), overdue: [], fatalToday: [t], hearingsToday: [], nextTwoDays: [] };
};
const emptyDto = (): BriefingDto => ({ today: d('2026-10-26'), overdue: [], fatalToday: [], hearingsToday: [], nextTwoDays: [] });

function setup(opts: { users?: Array<[string, number]>; telegram?: boolean; now?: Date } = {}) {
  const f = createFakes({ now: opts.now ?? AT_0800 });
  for (const [u, chat] of opts.users ?? [['u1', 111]]) f.links.setChat(u, chat);
  const logs: Log[] = [];
  const logger = {
    info: (event: string, fields: Record<string, unknown>) => logs.push({ level: 'info', event, fields }),
    error: (event: string, fields: Record<string, unknown>) => logs.push({ level: 'error', event, fields }),
  };
  const getBriefing = vi.fn(async (_userId: string): Promise<BriefingDto> => dto());
  const claimSpy = vi.spyOn(f.briefings, 'claim');
  const releaseSpy = vi.spyOn(f.briefings, 'release');
  const pauseSpy = vi.spyOn(f.reminderQueue, 'pauseChannel');
  const telegram: TelegramClient = f.telegram;
  const make = (over: { briefings?: BriefingRepository; budgetMs?: number } = {}) =>
    makeSendDailyBriefings({
      briefings: over.briefings ?? f.briefings,
      getBriefing,
      ...(opts.telegram === false ? {} : { telegram }),
      queue: f.reminderQueue,
      clock: f.clock,
      logger,
      ...(over.budgetMs === undefined ? {} : { budgetMs: over.budgetMs }),
    });
  return { f, logs, getBriefing, claimSpy, releaseSpy, pauseSpy, make };
}

const permanent = (reason: 'bot_bloqueado' | 'chat_inexistente' | 'outro'): TelegramErrorClass => ({
  kind: 'permanent',
  reason,
});

describe('recipient computation (dueFor) through the sender', () => {
  it('before the configured time: nothing is sent or claimed', async () => {
    const s = setup({ now: new Date('2026-10-26T10:59:00Z') }); // 07:59 local
    expect(await s.make()()).toEqual(ZERO);
    expect(s.claimSpy).not.toHaveBeenCalled();
    expect(s.f.telegram.sent).toEqual([]);
  });

  it('exactly at the configured time: sends (boundary 07:59 vs 08:00)', async () => {
    const s = setup();
    expect(await s.make()()).toEqual({ ...ZERO, sent: 1 });
  });

  it('inside the 4 h window sends; after the window nothing is sent and the day is NOT claimed', async () => {
    const inside = setup({ now: new Date('2026-10-26T14:59:00Z') }); // 11:59 local
    expect((await inside.make()()).sent).toBe(1);

    const late = setup({ now: new Date('2026-10-26T15:30:00Z') }); // 12:30 local
    expect(await late.make()()).toEqual(ZERO);
    expect(late.claimSpy).not.toHaveBeenCalled();
    expect(late.getBriefing).not.toHaveBeenCalled();
    expect(late.f.briefings.lastSent('u1')).toBeNull();
  });

  it('a user already on the next local date (Pacific/Auckland) is claimed with THEIR local date', async () => {
    const now = new Date('2026-10-26T19:30:00Z'); // 2026-10-27 08:30 em Auckland
    const s = setup({ now });
    s.f.setProfile('u1', { timezone: 'Pacific/Auckland' });
    expect(await s.make()()).toEqual({ ...ZERO, sent: 1 });
    expect(s.claimSpy).toHaveBeenCalledWith('u1', '2026-10-27');
    expect(s.f.briefings.lastSent('u1')).toBe('2026-10-27');
  });

  it('respects each user briefingTime and zone in the same run', async () => {
    const s = setup({ users: [['u1', 111], ['u2', 222]] });
    s.f.setProfile('u2', { briefingTime: '09:00' });
    expect(await s.make()()).toEqual({ ...ZERO, sent: 1 });
    expect(s.f.telegram.sent.map((m) => m.chatId)).toEqual([111]);
  });

  it('paused and unlinked profiles are never due', async () => {
    const s = setup({ users: [['u1', 111], ['u2', 222]] });
    s.f.links.setChat('u3', null);
    await s.f.reminderQueue.pauseChannel('u2');
    expect(await s.make()()).toEqual({ ...ZERO, sent: 1 });
    expect(s.claimSpy.mock.calls.map((c) => c[0])).toEqual(['u1']);
  });

  it('DST-gap briefing time does not crash the run', async () => {
    const s = setup({ now: new Date('2026-03-08T07:00:00Z') });
    s.f.setProfile('u1', { timezone: 'America/New_York', briefingTime: '02:30' });
    await expect(s.make()()).resolves.toEqual({ ...ZERO, sent: 1 });
  });
});

describe('makeSendDailyBriefings', () => {
  it('sends exactly renderBriefing(dto) to the chat, once; a second run the same local day does nothing', async () => {
    const s = setup();
    expect(await s.make()()).toEqual({ ...ZERO, sent: 1 });
    expect(s.f.telegram.sent).toEqual([{ chatId: 111, text: renderBriefing(dto()) }]);
    expect(s.getBriefing).toHaveBeenCalledWith('u1');

    s.f.setNow(new Date(AT_0800.getTime() + 60_000));
    expect(await s.make()()).toEqual(ZERO);
    expect(s.f.telegram.sent).toHaveLength(1);
    expect(s.claimSpy).toHaveBeenCalledTimes(1);
  });

  it('the next local day sends again', async () => {
    const s = setup();
    await s.make()();
    s.f.setNow(new Date(AT_0800.getTime() + 24 * 3_600_000));
    expect(await s.make()()).toEqual({ ...ZERO, sent: 1 });
    expect(s.f.telegram.sent).toHaveLength(2);
    expect(s.f.briefings.lastSent('u1')).toBe('2026-10-27');
  });

  it('empty briefing: skippedEmpty, nothing sent, the day stays claimed (second run sends nothing)', async () => {
    const s = setup();
    s.getBriefing.mockResolvedValue(emptyDto());
    expect(await s.make()()).toEqual({ ...ZERO, skippedEmpty: 1 });
    expect(s.f.telegram.sent).toEqual([]);
    expect(s.releaseSpy).not.toHaveBeenCalled();
    expect(s.f.briefings.lastSent('u1')).toBe('2026-10-26');
    expect(await s.make()()).toEqual(ZERO);
    expect(s.getBriefing).toHaveBeenCalledTimes(1);
  });

  it('transient failure: releases the claim and the NEXT run retries and sends', async () => {
    const s = setup();
    s.f.telegram.failNext({ kind: 'transient' });
    expect(await s.make()()).toEqual({ ...ZERO, retried: 1 });
    expect(s.releaseSpy).toHaveBeenCalledWith('u1', '2026-10-26');
    expect(s.f.briefings.lastSent('u1')).toBe('2026-10-25');

    s.f.setNow(new Date(AT_0800.getTime() + 60_000));
    expect(await s.make()()).toEqual({ ...ZERO, sent: 1 });
    expect(s.f.telegram.sent).toHaveLength(2);
    expect(s.f.briefings.lastSent('u1')).toBe('2026-10-26');
    expect(await s.make()()).toEqual(ZERO);
  });

  it('transient failure after the window closes is not retried (nothing due)', async () => {
    const s = setup({ now: new Date('2026-10-26T14:59:00Z') });
    s.f.telegram.failNext({ kind: 'transient', retryAfterMs: 1000 });
    expect(await s.make()()).toEqual({ ...ZERO, retried: 1 });
    s.f.setNow(new Date('2026-10-26T15:30:00Z'));
    expect(await s.make()()).toEqual(ZERO);
  });

  it('403 bot blocked: pauses the channel, no retry, the day stays claimed', async () => {
    const s = setup();
    s.f.telegram.failNext(permanent('bot_bloqueado'));
    expect(await s.make()()).toEqual({ ...ZERO, failed: 1, paused: 1 });
    expect(s.pauseSpy).toHaveBeenCalledTimes(1);
    expect(s.pauseSpy).toHaveBeenCalledWith('u1');
    expect(s.f.links.isPaused('u1')).toBe(true);
    expect(s.releaseSpy).not.toHaveBeenCalled();
    expect(s.f.briefings.lastSent('u1')).toBe('2026-10-26');
    expect(await s.make()()).toEqual(ZERO);
  });

  it('chat_inexistente also pauses', async () => {
    const s = setup();
    s.f.telegram.failNext(permanent('chat_inexistente'));
    expect(await s.make()()).toEqual({ ...ZERO, failed: 1, paused: 1 });
    expect(s.f.links.isPaused('u1')).toBe(true);
  });

  it("permanent 'outro' (401/404): failed, NOT paused, no release, stays claimed (Ruling 18)", async () => {
    const s = setup();
    s.f.telegram.failNext(permanent('outro'));
    expect(await s.make()()).toEqual({ ...ZERO, failed: 1 });
    expect(s.pauseSpy).not.toHaveBeenCalled();
    expect(s.f.links.isPaused('u1')).toBe(false);
    expect(s.releaseSpy).not.toHaveBeenCalled();
    expect(s.f.briefings.lastSent('u1')).toBe('2026-10-26');
    expect(s.logs.some((l) => l.level === 'error' && l.fields.reason === 'outro')).toBe(true);
  });

  it('if pauseChannel throws, the run continues with the next recipient', async () => {
    const s = setup({ users: [['u1', 111], ['u2', 222]] });
    s.f.telegram.failNext(permanent('bot_bloqueado'));
    s.pauseSpy.mockRejectedValueOnce(Object.assign(new Error(`falha ${SECRET}`), { name: 'PauseError' }));
    expect(await s.make()()).toEqual({ ...ZERO, failed: 1, sent: 1 });
    expect(s.f.telegram.sent.map((m) => m.chatId)).toEqual([111, 222]);
    expect(JSON.stringify(s.logs)).not.toContain(SECRET);
  });

  it('getBriefing throws: releases, logs by error NAME only, next recipient still processed', async () => {
    const s = setup({ users: [['u1', 111], ['u2', 222]] });
    s.getBriefing.mockImplementationOnce(async () => {
      throw Object.assign(new Error(`conexão caiu ${SECRET}`), { name: 'DbDownError' });
    });
    expect(await s.make()()).toEqual({ ...ZERO, failed: 1, sent: 1 });
    expect(s.releaseSpy).toHaveBeenCalledWith('u1', '2026-10-26');
    expect(s.f.briefings.lastSent('u1')).toBe('2026-10-25');
    expect(s.f.telegram.sent.map((m) => m.chatId)).toEqual([222]);
    expect(s.logs.filter((l) => l.level === 'error').map((l) => l.fields.errorName)).toContain('DbDownError');
    expect(JSON.stringify(s.logs)).not.toContain(SECRET);

    // o próximo minuto tenta de novo
    s.f.setNow(new Date(AT_0800.getTime() + 60_000));
    expect(await s.make()()).toEqual({ ...ZERO, sent: 1 });
  });

  it('release itself throwing is logged by name and the run continues', async () => {
    const s = setup({ users: [['u1', 111], ['u2', 222]] });
    s.getBriefing.mockImplementationOnce(async () => {
      throw new Error('x');
    });
    s.releaseSpy.mockRejectedValueOnce(Object.assign(new Error(`rel ${SECRET}`), { name: 'ReleaseError' }));
    expect(await s.make()()).toEqual({ ...ZERO, failed: 1, sent: 1 });
    expect(s.logs.some((l) => l.fields.errorName === 'ReleaseError')).toBe(true);
    expect(JSON.stringify(s.logs)).not.toContain(SECRET);
  });

  it('release throwing after a transient send failure is logged and the run continues', async () => {
    const s = setup({ users: [['u1', 111], ['u2', 222]] });
    s.f.telegram.failNext({ kind: 'transient' });
    s.releaseSpy.mockRejectedValueOnce(Object.assign(new Error('r'), { name: 'ReleaseError' }));
    expect(await s.make()()).toEqual({ ...ZERO, retried: 1, sent: 1 });
    expect(s.logs.some((l) => l.fields.errorName === 'ReleaseError')).toBe(true);
  });

  it('an unexpected exception from sendMessage for one recipient never stops the others (day stays claimed)', async () => {
    const s = setup({ users: [['u1', 111], ['u2', 222]] });
    const real = s.f.telegram.sendMessage.bind(s.f.telegram);
    const spy = vi.spyOn(s.f.telegram, 'sendMessage');
    spy.mockImplementationOnce(async () => {
      throw Object.assign(new Error(`rede ${SECRET}`), { name: 'NetError' });
    });
    spy.mockImplementation(real);
    expect(await s.make()()).toEqual({ ...ZERO, failed: 1, sent: 1 });
    expect(s.f.briefings.lastSent('u1')).toBe('2026-10-26');
    expect(s.releaseSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(s.logs)).not.toContain(SECRET);
  });

  it('a claim that throws is counted failed and the others continue', async () => {
    const s = setup({ users: [['u1', 111], ['u2', 222]] });
    s.claimSpy.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'ClaimError' }));
    expect(await s.make()()).toEqual({ ...ZERO, failed: 1, sent: 1 });
    expect(s.logs.some((l) => l.fields.errorName === 'ClaimError')).toBe(true);
  });

  it('claim false (someone else has it): skipped silently, no getBriefing, no send', async () => {
    const s = setup();
    s.claimSpy.mockResolvedValueOnce(false);
    expect(await s.make()()).toEqual(ZERO);
    expect(s.getBriefing).not.toHaveBeenCalled();
    expect(s.f.telegram.sent).toEqual([]);
  });

  it('telegram undefined: zeros immediately and claim is never called', async () => {
    const s = setup({ telegram: false });
    expect(await s.make()()).toEqual(ZERO);
    expect(s.claimSpy).not.toHaveBeenCalled();
    expect(s.getBriefing).not.toHaveBeenCalled();
    expect(s.f.briefings.lastSent('u1')).toBeNull();
  });

  it('simultaneous executions (atomic claim): exactly one send per user', async () => {
    const s = setup({ users: [['u1', 111], ['u2', 222]] });
    const run = s.make();
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.sent + b.sent).toBe(2);
    expect(s.f.telegram.sent.map((m) => m.chatId).sort()).toEqual([111, 222]);
  });

  it('processes recipients sequentially', async () => {
    const s = setup({ users: [['u1', 111], ['u2', 222]] });
    let inFlight = 0;
    let max = 0;
    const real = s.f.telegram.sendMessage.bind(s.f.telegram);
    vi.spyOn(s.f.telegram, 'sendMessage').mockImplementation(async (c, t) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      const res = await real(c, t);
      inFlight -= 1;
      return res;
    });
    await s.make()();
    expect(max).toBe(1);
  });

  it('budget exceeded: remaining recipients are deferred WITHOUT claiming', async () => {
    const s = setup({ users: [['u1', 111], ['u2', 222], ['u3', 333]] });
    const real = s.f.telegram.sendMessage.bind(s.f.telegram);
    vi.spyOn(s.f.telegram, 'sendMessage').mockImplementation(async (c, t) => {
      s.f.setNow(new Date(s.f.clock.now().getTime() + 30_000)); // cada envio "demora" 30 s
      return real(c, t);
    });
    expect(await s.make()()).toEqual({ ...ZERO, sent: 1, deferred: 2 });
    expect(s.claimSpy.mock.calls.map((c) => c[0])).toEqual(['u1']);
    expect(s.f.briefings.lastSent('u2')).toBeNull();
    expect(s.f.briefings.lastSent('u3')).toBeNull();
    expect(s.logs.some((l) => l.event === 'briefing.deferred')).toBe(true);
  });

  it('budgetMs option is honored (budget 0 defers everything once time has passed)', async () => {
    const s = setup({ users: [['u1', 111], ['u2', 222]] });
    const real = s.f.telegram.sendMessage.bind(s.f.telegram);
    vi.spyOn(s.f.telegram, 'sendMessage').mockImplementation(async (c, t) => {
      s.f.setNow(new Date(s.f.clock.now().getTime() + 1));
      return real(c, t);
    });
    expect(await s.make({ budgetMs: 0 })()).toEqual({ ...ZERO, sent: 1, deferred: 1 });
  });

  it('logger never receives briefing text, titles or chat ids', async () => {
    const s = setup({ users: [['u1', 111], ['u2', 222]] });
    s.f.telegram.failNext(permanent('outro'));
    await s.make()();
    s.f.telegram.failNext({ kind: 'transient' });
    s.f.setNow(new Date(AT_0800.getTime() + 60_000));
    await s.make()();
    const all = JSON.stringify(s.logs);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('Bom dia');
    expect(all).not.toContain('111');
    expect(all).not.toContain('222');
    expect(s.logs.some((l) => l.event === 'briefings.run')).toBe(true);
  });

  it('works without a logger', async () => {
    const f = createFakes({ now: AT_0800 });
    f.links.setChat('u1', 111);
    const run = makeSendDailyBriefings({
      briefings: f.briefings,
      getBriefing: async () => dto(),
      telegram: f.telegram,
      queue: f.reminderQueue,
      clock: f.clock,
    });
    expect(await run()).toEqual({ ...ZERO, sent: 1 });
  });

});
