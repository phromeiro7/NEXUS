import { describe, expect, it } from 'vitest';
import type { MaintenanceRepository } from './ports.js';
import { makeRunScheduler, SCHEDULER_BUDGETS_MS } from './scheduler.js';

const NOW = new Date('2026-10-26T12:00:00.000Z');
const remindersResult = { sent: 1, retried: 2, failed: 3, cancelled: 4, recovered: 5, paused: 6, leaseLost: 7, deferred: 8 };
const briefingsResult = { sent: 1, skippedEmpty: 2, retried: 3, failed: 4, paused: 5, deferred: 6 };
const zeroReminders = { sent: 0, retried: 0, failed: 0, cancelled: 0, recovered: 0, paused: 0, leaseLost: 0, deferred: 0 };
const zeroBriefings = { sent: 0, skippedEmpty: 0, retried: 0, failed: 0, paused: 0, deferred: 0 };

function setup(fail: string[] = []) {
  const calls: string[] = [];
  const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const step = <T>(name: string, value: T) => async (..._a: unknown[]): Promise<T> => {
    calls.push(name);
    if (fail.includes(name)) {
      const e = new Error('SEGREDO_NO_TEXTO titulo da tarefa');
      e.name = 'BoomError';
      throw e;
    }
    return value;
  };
  const maintenance: MaintenanceRepository = {
    recoverStuckEvents: step('recoverStuckEvents', { recovered: 2, failed: 1 }),
    purgeExpiredChatMessages: step('purgeChat', 10),
    purgeExpiredLinkCodes: step('purgeLink', 20),
    purgeOldModelCalls: step('purgeModel', 30),
  };
  const run = makeRunScheduler({
    maintenance,
    runReminders: step('runReminders', remindersResult),
    sendDailyBriefings: step('sendDailyBriefings', briefingsResult),
    clock: { now: () => NOW },
    logger: {
      info: (event, fields) => logs.push({ event, fields }),
      error: (event, fields) => logs.push({ event, fields }),
    },
  });
  return { run, calls, logs };
}

describe('makeRunScheduler', () => {
  it('runs the steps in the specified order and returns the exact result shape', async () => {
    const { run, calls } = setup();
    const result = await run();
    expect(calls).toEqual([
      'recoverStuckEvents',
      'runReminders',
      'sendDailyBriefings',
      'purgeChat',
      'purgeLink',
      'purgeModel',
    ]);
    expect(result).toEqual({
      reminders: remindersResult,
      briefings: briefingsResult,
      eventsRecovered: { recovered: 2, failed: 1 },
      purged: { chatMessages: 10, linkCodes: 20, modelCalls: 30 },
    });
  });

  it('runs the steps strictly sequentially: each one ends before the next starts', async () => {
    const events: string[] = [];
    const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
    const step = <T>(name: string, value: T) => async (..._a: unknown[]): Promise<T> => {
      events.push(`start:${name}`);
      await tick();
      events.push(`end:${name}`);
      return value;
    };
    const run = makeRunScheduler({
      maintenance: {
        recoverStuckEvents: step('recover', { recovered: 0, failed: 0 }),
        purgeExpiredChatMessages: step('purgeChat', 0),
        purgeExpiredLinkCodes: step('purgeLink', 0),
        purgeOldModelCalls: step('purgeModel', 0),
      },
      runReminders: step('reminders', zeroReminders),
      sendDailyBriefings: step('briefings', zeroBriefings),
      clock: { now: () => NOW },
    });
    await run();
    expect(events).toEqual(
      ['recover', 'reminders', 'briefings', 'purgeChat', 'purgeLink', 'purgeModel'].flatMap((n) => [`start:${n}`, `end:${n}`]),
    );
  });

  it('passes the clock time to the maintenance steps', async () => {
    const seen: Date[] = [];
    const run = makeRunScheduler({
      maintenance: {
        recoverStuckEvents: async (n) => (seen.push(n), { recovered: 0, failed: 0 }),
        purgeExpiredChatMessages: async (n) => (seen.push(n), 0),
        purgeExpiredLinkCodes: async (n) => (seen.push(n), 0),
        purgeOldModelCalls: async (n) => (seen.push(n), 0),
      },
      runReminders: async () => zeroReminders,
      sendDailyBriefings: async () => zeroBriefings,
      clock: { now: () => NOW },
    });
    await run();
    expect(seen).toEqual([NOW, NOW, NOW, NOW]);
  });

  const cases: Array<[string, string[], Record<string, unknown>]> = [
    ['recoverStuckEvents', ['recoverStuckEvents'], { eventsRecovered: { recovered: 0, failed: 0 } }],
    ['runReminders', ['runReminders'], { reminders: zeroReminders }],
    ['sendDailyBriefings', ['sendDailyBriefings'], { briefings: zeroBriefings }],
    ['purgeChat', ['purgeChat'], { purged: { chatMessages: 0, linkCodes: 20, modelCalls: 30 } }],
    ['purgeLink', ['purgeLink'], { purged: { chatMessages: 10, linkCodes: 0, modelCalls: 30 } }],
    ['purgeModel', ['purgeModel'], { purged: { chatMessages: 10, linkCodes: 20, modelCalls: 0 } }],
  ];
  it.each(cases)('a throwing %s never stops the others; it contributes zeros and logs the name only', async (name, fail, patch) => {
    const { run, calls, logs } = setup(fail);
    const result = await run();
    expect(calls).toHaveLength(6);
    expect(result).toEqual({
      reminders: remindersResult,
      briefings: briefingsResult,
      eventsRecovered: { recovered: 2, failed: 1 },
      purged: { chatMessages: 10, linkCodes: 20, modelCalls: 30 },
      ...patch,
    });
    const failed = logs.filter((l) => l.event === 'scheduler.step_failed');
    expect(failed).toEqual([{ event: 'scheduler.step_failed', fields: { step: expect.any(String), errorName: 'BoomError' } }]);
    expect(JSON.stringify(logs)).not.toContain('SEGREDO_NO_TEXTO');
  });

  it('all steps failing still resolves with all zeros', async () => {
    const { run, logs } = setup([
      'recoverStuckEvents',
      'runReminders',
      'sendDailyBriefings',
      'purgeChat',
      'purgeLink',
      'purgeModel',
    ]);
    expect(await run()).toEqual({
      reminders: zeroReminders,
      briefings: zeroBriefings,
      eventsRecovered: { recovered: 0, failed: 0 },
      purged: { chatMessages: 0, linkCodes: 0, modelCalls: 0 },
    });
    expect(logs.filter((l) => l.event === 'scheduler.step_failed').map((l) => l.fields.step)).toEqual([
      'recover_stuck_events',
      'reminders',
      'briefings',
      'purge_chat_messages',
      'purge_link_codes',
      'purge_model_calls',
    ]);
  });

  it('a non-Error throw is logged as desconhecido', async () => {
    const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const run = makeRunScheduler({
      maintenance: {
        recoverStuckEvents: async () => ({ recovered: 0, failed: 0 }),
        purgeExpiredChatMessages: async () => 0,
        purgeExpiredLinkCodes: async () => 0,
        purgeOldModelCalls: async () => 0,
      },
      runReminders: async () => {
        throw 'texto secreto';
      },
      sendDailyBriefings: async () => zeroBriefings,
      clock: { now: () => NOW },
      logger: { info: () => undefined, error: (event, fields) => logs.push({ event, fields }) },
    });
    await run();
    expect(logs).toEqual([{ event: 'scheduler.step_failed', fields: { step: 'reminders', errorName: 'desconhecido' } }]);
  });

  it('has sub-step budgets whose sum leaves room under ~30 s', () => {
    expect(SCHEDULER_BUDGETS_MS).toEqual({ reminders: 15_000, briefings: 8_000 });
  });
});
