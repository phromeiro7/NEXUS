import type { IsoDate } from '@nexus/shared';
import { describe, expect, it } from 'vitest';
import { buildReminders, InvalidLocalTimeError, resolveDefaultReminderTime } from './reminders.js';
import type { LocalToUtcResult } from './timezone.js';

const d = (s: string): IsoDate => s as IsoDate;
const now = new Date('2026-10-26T12:00:00Z');
const SP = 'America/Sao_Paulo';
const base = {
  dueDate: d('2026-10-30') as IsoDate | null,
  dueTime: null as string | null,
  fatal: false,
  timeZone: SP,
  earlyMinutes: null as number | null,
  now,
};
const view = (r: ReturnType<typeof buildReminders>) =>
  r.map((x) => ({ kind: x.kind, at: x.scheduledAt.toISOString() }));

describe('buildReminders date-only', () => {
  it('yields dia_anterior and no_dia at 08:00 local', () => {
    expect(view(buildReminders(base))).toEqual([
      { kind: 'dia_anterior', at: '2026-10-29T11:00:00.000Z' },
      { kind: 'no_dia', at: '2026-10-30T11:00:00.000Z' },
    ]);
  });

  it('adds tres_dias first when fatal', () => {
    expect(view(buildReminders({ ...base, fatal: true }))).toEqual([
      { kind: 'tres_dias', at: '2026-10-27T11:00:00.000Z' },
      { kind: 'dia_anterior', at: '2026-10-29T11:00:00.000Z' },
      { kind: 'no_dia', at: '2026-10-30T11:00:00.000Z' },
    ]);
  });

  it('returns [] when there is no due date', () => {
    expect(buildReminders({ ...base, dueDate: null })).toEqual([]);
  });

  it('drops reminders already in the past', () => {
    // due tomorrow: dia_anterior is today 08:00 local (11:00Z) < now
    expect(view(buildReminders({ ...base, dueDate: d('2026-10-27') }))).toEqual([
      { kind: 'no_dia', at: '2026-10-27T11:00:00.000Z' },
    ]);
  });

  it('drops a reminder scheduled exactly at now', () => {
    const exact = new Date('2026-10-29T11:00:00Z');
    expect(view(buildReminders({ ...base, now: exact }))).toEqual([
      { kind: 'no_dia', at: '2026-10-30T11:00:00.000Z' },
    ]);
  });

  it('keeps 08:00 local in a DST zone', () => {
    // New York is UTC-4 on 2026-10-30 (DST ends 2026-11-01)
    const r = buildReminders({ ...base, timeZone: 'America/New_York' });
    expect(view(r)[1]).toEqual({ kind: 'no_dia', at: '2026-10-30T12:00:00.000Z' });
  });
});

describe('buildReminders with time', () => {
  const timed = { ...base, dueDate: d('2026-10-27'), dueTime: '09:00', earlyMinutes: 15 };

  it('yields antecipado and no_horario', () => {
    expect(view(buildReminders(timed))).toEqual([
      { kind: 'antecipado', at: '2026-10-27T11:45:00.000Z' },
      { kind: 'no_horario', at: '2026-10-27T12:00:00.000Z' },
    ]);
  });

  it('drops an antecipado that already passed', () => {
    const r = buildReminders({ ...timed, dueDate: d('2026-10-26'), dueTime: '09:10' });
    expect(view(r)).toEqual([{ kind: 'no_horario', at: '2026-10-26T12:10:00.000Z' }]);
  });

  it('omits antecipado when earlyMinutes is null', () => {
    expect(view(buildReminders({ ...timed, earlyMinutes: null }))).toEqual([
      { kind: 'no_horario', at: '2026-10-27T12:00:00.000Z' },
    ]);
  });

  it('treats earlyMinutes 0 as no distinct antecipado', () => {
    expect(view(buildReminders({ ...timed, earlyMinutes: 0 }))).toEqual([
      { kind: 'no_horario', at: '2026-10-27T12:00:00.000Z' },
    ]);
  });

  it('does not add date-only reminders when a time is present, even if fatal', () => {
    const kinds = buildReminders({ ...timed, fatal: true }).map((x) => x.kind);
    expect(kinds).toEqual(['antecipado', 'no_horario']);
  });

  it('throws InvalidLocalTimeError hora_inexistente for a nonexistent local time', () => {
    const run = () =>
      buildReminders({
        ...base,
        dueDate: d('2026-03-08'),
        dueTime: '02:30',
        timeZone: 'America/New_York',
        now: new Date('2026-01-01T00:00:00Z'),
      });
    expect(run).toThrow(InvalidLocalTimeError);
    expect(run).toThrow(expect.objectContaining({ reason: 'hora_inexistente' }));
  });

  it('throws InvalidLocalTimeError hora_ambigua for an ambiguous local time', () => {
    expect(() =>
      buildReminders({
        ...base,
        dueDate: d('2026-11-01'),
        dueTime: '01:30',
        timeZone: 'America/New_York',
        now: new Date('2026-01-01T00:00:00Z'),
      }),
    ).toThrow(expect.objectContaining({ reason: 'hora_ambigua' }));
  });
});

describe('resolveDefaultReminderTime', () => {
  const ok = (iso: string): LocalToUtcResult => ({ ok: true, utc: new Date(iso) });
  const gap: LocalToUtcResult = { ok: false, reason: 'hora_inexistente' };
  const overlap: LocalToUtcResult = { ok: false, reason: 'hora_ambigua' };

  it('uses 08:00 when it exists', () => {
    const seen: string[] = [];
    const out = resolveDefaultReminderTime(d('2026-10-30'), SP, (_date, time) => {
      seen.push(time);
      return ok('2026-10-30T11:00:00Z');
    });
    expect(out.toISOString()).toBe('2026-10-30T11:00:00.000Z');
    expect(seen).toEqual(['08:00']);
  });

  it.each([gap, overlap])('falls back to 09:00 when 08:00 fails (%o)', (failure) => {
    const out = resolveDefaultReminderTime(d('2026-10-30'), SP, (_date, time) =>
      time === '08:00' ? failure : ok('2026-10-30T12:00:00Z'),
    );
    expect(out.toISOString()).toBe('2026-10-30T12:00:00.000Z');
  });

  it('throws InvalidLocalTimeError when 09:00 also fails', () => {
    expect(() => resolveDefaultReminderTime(d('2026-10-30'), SP, () => gap)).toThrow(
      InvalidLocalTimeError,
    );
  });
});
