import type { IsoDate } from '@aj/shared';
import { describe, expect, it } from 'vitest';
import { localToUtc } from './timezone.js';

const d = (s: string): IsoDate => s as IsoDate;
const iso = (r: ReturnType<typeof localToUtc>): string =>
  r.ok ? r.utc.toISOString() : r.reason;

describe('localToUtc', () => {
  it('converts a normal Sao Paulo time (UTC-3)', () => {
    expect(localToUtc(d('2026-10-27'), '09:00', 'America/Sao_Paulo')).toEqual({
      ok: true,
      utc: new Date('2026-10-27T12:00:00Z'),
    });
  });

  it('accepts midnight in Sao Paulo (UTC-3 year-round)', () => {
    expect(iso(localToUtc(d('2026-10-27'), '00:00', 'America/Sao_Paulo'))).toBe(
      '2026-10-27T03:00:00.000Z',
    );
    expect(iso(localToUtc(d('2026-01-15'), '00:00', 'America/Sao_Paulo'))).toBe(
      '2026-01-15T03:00:00.000Z',
    );
  });

  it('converts a winter time in New York (UTC-5)', () => {
    expect(iso(localToUtc(d('2026-01-15'), '09:00', 'America/New_York'))).toBe(
      '2026-01-15T14:00:00.000Z',
    );
  });

  it('converts a summer time in New York (UTC-4)', () => {
    expect(iso(localToUtc(d('2026-07-15'), '09:00', 'America/New_York'))).toBe(
      '2026-07-15T13:00:00.000Z',
    );
  });

  it('handles a half-hour offset without DST', () => {
    expect(iso(localToUtc(d('2026-10-27'), '09:00', 'Asia/Kolkata'))).toBe(
      '2026-10-27T03:30:00.000Z',
    );
  });

  it('rejects a time skipped by spring-forward', () => {
    expect(localToUtc(d('2026-03-08'), '02:30', 'America/New_York')).toEqual({
      ok: false,
      reason: 'hora_inexistente',
    });
    expect(localToUtc(d('2026-03-08'), '02:00', 'America/New_York')).toEqual({
      ok: false,
      reason: 'hora_inexistente',
    });
  });

  it('rejects a time repeated by fall-back', () => {
    expect(localToUtc(d('2026-11-01'), '01:30', 'America/New_York')).toEqual({
      ok: false,
      reason: 'hora_ambigua',
    });
    expect(localToUtc(d('2026-11-01'), '01:00', 'America/New_York')).toEqual({
      ok: false,
      reason: 'hora_ambigua',
    });
  });

  it('accepts times just outside the fall-back overlap', () => {
    expect(iso(localToUtc(d('2026-11-01'), '00:59', 'America/New_York'))).toBe(
      '2026-11-01T04:59:00.000Z',
    );
    expect(iso(localToUtc(d('2026-11-01'), '02:00', 'America/New_York'))).toBe(
      '2026-11-01T07:00:00.000Z',
    );
    expect(iso(localToUtc(d('2026-11-01'), '03:00', 'America/New_York'))).toBe(
      '2026-11-01T08:00:00.000Z',
    );
  });

  it('accepts times just outside the spring-forward gap', () => {
    expect(iso(localToUtc(d('2026-03-08'), '01:59', 'America/New_York'))).toBe(
      '2026-03-08T06:59:00.000Z',
    );
    expect(iso(localToUtc(d('2026-03-08'), '03:00', 'America/New_York'))).toBe(
      '2026-03-08T07:00:00.000Z',
    );
  });

  it('handles a southern-hemisphere zone with a 30-minute DST shift', () => {
    // Lord Howe: UTC+11 in summer, UTC+10:30 in winter; clocks go back 02:00 -> 01:30 on 2026-04-05.
    expect(localToUtc(d('2026-04-05'), '01:45', 'Australia/Lord_Howe')).toEqual({
      ok: false,
      reason: 'hora_ambigua',
    });
    expect(iso(localToUtc(d('2026-04-05'), '03:00', 'Australia/Lord_Howe'))).toBe(
      '2026-04-04T16:30:00.000Z',
    );
  });

  it('throws RangeError for an invalid time string', () => {
    for (const t of ['9:00', '24:00', '12:60', '12:00:00', 'abc', '']) {
      expect(() => localToUtc(d('2026-10-27'), t, 'America/Sao_Paulo')).toThrow(RangeError);
    }
  });

  it('throws RangeError for calendar-invalid or malformed dates', () => {
    for (const dt of ['2026-02-31', '2027-02-29', '2026-1-5', '2026-13-01', '2026-00-10', '']) {
      expect(() => localToUtc(d(dt), '09:00', 'America/Sao_Paulo')).toThrow(RangeError);
    }
  });

  it('still converts a valid leap day', () => {
    expect(iso(localToUtc(d('2028-02-29'), '09:00', 'America/Sao_Paulo'))).toBe(
      '2028-02-29T12:00:00.000Z',
    );
  });

  it('flags the last minute of the gap and of the overlap', () => {
    expect(localToUtc(d('2026-03-08'), '02:59', 'America/New_York')).toEqual({
      ok: false,
      reason: 'hora_inexistente',
    });
    expect(localToUtc(d('2026-11-01'), '01:59', 'America/New_York')).toEqual({
      ok: false,
      reason: 'hora_ambigua',
    });
  });

  it('throws RangeError for an unknown time zone', () => {
    expect(() => localToUtc(d('2026-10-27'), '09:00', 'Mars/Olympus')).toThrow(RangeError);
  });
});
