import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_INTERVAL_SECONDS, loopIntervalMs, runLoop } from './reminders-loop.js';

describe('loopIntervalMs', () => {
  it('defaults to 60 s when unset or empty', () => {
    expect(loopIntervalMs({})).toBe(DEFAULT_INTERVAL_SECONDS * 1000);
    expect(loopIntervalMs({ REMINDERS_LOOP_SECONDS: '  ' })).toBe(60_000);
  });

  it('reads whole seconds between 5 and 3600', () => {
    expect(loopIntervalMs({ REMINDERS_LOOP_SECONDS: '5' })).toBe(5_000);
    expect(loopIntervalMs({ REMINDERS_LOOP_SECONDS: '3600' })).toBe(3_600_000);
  });

  it.each(['4', '3601', '1.5', 'abc', '-10'])('rejects %s and names the variable', (value) => {
    expect(() => loopIntervalMs({ REMINDERS_LOOP_SECONDS: value })).toThrow('REMINDERS_LOOP_SECONDS');
  });
});

describe('runLoop', () => {
  it('ticks, waits the interval, and stops when the sleep is interrupted', async () => {
    const tick = vi.fn().mockResolvedValue(0);
    const sleeps: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleeps.push(ms);
      return sleeps.length < 3; // two full waits, then interrupted
    });
    const log = vi.fn();
    const passes = await runLoop({ tick, sleep, intervalMs: 60_000, log, now: () => new Date('2026-11-04T12:00:00Z') });
    expect(passes).toBe(3);
    expect(tick).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([60_000, 60_000, 60_000]);
    expect(log).toHaveBeenCalledWith('2026-11-04T12:00:00.000Z tick ok');
  });

  it('keeps going after a failed or throwing tick, logging only a fixed line', async () => {
    const tick = vi.fn().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('segredo-vazado')).mockResolvedValue(0);
    let waits = 0;
    const log = vi.fn();
    await runLoop({ tick, sleep: async () => ++waits < 3, intervalMs: 5_000, log, now: () => new Date(0) });
    expect(tick).toHaveBeenCalledTimes(3);
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      '1970-01-01T00:00:00.000Z tick falhou',
      '1970-01-01T00:00:00.000Z tick falhou',
      '1970-01-01T00:00:00.000Z tick ok',
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('segredo-vazado');
  });
});
