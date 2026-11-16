import type { IsoDate, TaskType } from '@nexus/shared';
import { describe, expect, it } from 'vitest';
import type { ReminderKind } from './reminders.js';
import { classifyTelegramError, isLate, renderReminder, retryDelayMs } from './reminder-message.js';

const base = {
  kind: 'no_dia' as ReminderKind,
  title: 'Contestação',
  taskType: 'prazo' as TaskType,
  dueDate: '2026-10-27' as IsoDate,
  dueTime: null as string | null,
  fatal: false,
  late: false,
};

describe('renderReminder', () => {
  it('tres_dias', () => {
    expect(renderReminder({ ...base, kind: 'tres_dias', fatal: true })).toBe(
      'Prazo fatal em 3 dias, 27/10: Contestação',
    );
  });

  it('dia_anterior fatal vs non-fatal', () => {
    expect(renderReminder({ ...base, kind: 'dia_anterior', fatal: true })).toBe(
      'Prazo fatal amanhã, 27/10: Contestação',
    );
    expect(renderReminder({ ...base, kind: 'dia_anterior' })).toBe('Prazo amanhã, 27/10: Contestação');
  });

  it('no_dia fatal vs non-fatal', () => {
    expect(renderReminder({ ...base, kind: 'no_dia', fatal: true })).toBe(
      'Prazo fatal hoje, 27/10: Contestação',
    );
    expect(renderReminder({ ...base, kind: 'no_dia' })).toBe('Prazo hoje, 27/10: Contestação');
  });

  it.each<[TaskType, string]>([
    ['prazo', 'Prazo'],
    ['tarefa', 'Tarefa'],
    ['audiencia', 'Audiência'],
  ])('uses the label for task type %s', (taskType, label) => {
    expect(renderReminder({ ...base, taskType })).toBe(`${label} hoje, 27/10: Contestação`);
    expect(renderReminder({ ...base, taskType, kind: 'dia_anterior' })).toBe(
      `${label} amanhã, 27/10: Contestação`,
    );
    expect(renderReminder({ ...base, taskType, kind: 'no_horario', dueTime: '14:30' })).toBe(
      `${label} agora, às 14:30: Contestação`,
    );
    expect(renderReminder({ ...base, taskType, kind: 'antecipado', dueTime: '14:30' })).toBe(
      `${label} às 14:30 (em breve): Contestação`,
    );
  });

  it('fatal replaces the type label for audiencia in no_dia', () => {
    expect(renderReminder({ ...base, taskType: 'audiencia', fatal: true })).toBe(
      'Prazo fatal hoje, 27/10: Contestação',
    );
  });

  it('antecipado and no_horario use the real time and ignore fatal', () => {
    expect(renderReminder({ ...base, kind: 'antecipado', dueTime: '09:05', fatal: true })).toBe(
      'Prazo às 09:05 (em breve): Contestação',
    );
    expect(renderReminder({ ...base, kind: 'no_horario', dueTime: '09:05', fatal: true })).toBe(
      'Prazo agora, às 09:05: Contestação',
    );
  });

  it('antecipado and no_horario without time fall back to the no_dia format', () => {
    expect(renderReminder({ ...base, kind: 'antecipado' })).toBe('Prazo hoje, 27/10: Contestação');
    expect(renderReminder({ ...base, kind: 'no_horario', fatal: true })).toBe(
      'Prazo fatal hoje, 27/10: Contestação',
    );
  });

  it('appends (atrasado) when late', () => {
    expect(renderReminder({ ...base, late: true })).toBe('Prazo hoje, 27/10: Contestação (atrasado)');
    expect(renderReminder({ ...base, kind: 'no_horario', dueTime: '10:00', late: true })).toBe(
      'Prazo agora, às 10:00: Contestação (atrasado)',
    );
  });

  it('formats day and month with zero padding from the ISO date', () => {
    expect(renderReminder({ ...base, dueDate: '2027-01-05' as IsoDate })).toBe(
      'Prazo hoje, 05/01: Contestação',
    );
  });

  describe('title sanitization', () => {
    it('collapses newlines and tabs to single spaces', () => {
      expect(renderReminder({ ...base, title: 'Título\nIGNORE\tTAB' })).toBe(
        'Prazo hoje, 27/10: Título IGNORE TAB',
      );
    });

    it('collapses whitespace runs and trims', () => {
      expect(renderReminder({ ...base, title: '  a \r\n\n  b  ' })).toBe('Prazo hoje, 27/10: a b');
    });

    it('keeps a 200-character title intact', () => {
      const title = 'x'.repeat(200);
      expect(renderReminder({ ...base, title })).toBe(`Prazo hoje, 27/10: ${title}`);
    });

    it('truncates a 300-character title to 200 characters ending with an ellipsis', () => {
      const out = renderReminder({ ...base, title: 'x'.repeat(300) });
      expect(out).toBe(`Prazo hoje, 27/10: ${'x'.repeat(199)}…`);
    });

    it('never splits a surrogate pair at the cut', () => {
      const title = `${'x'.repeat(198)}😀😀😀`;
      const out = renderReminder({ ...base, title });
      expect(out).toBe(`Prazo hoje, 27/10: ${'x'.repeat(198)}😀…`);
      expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    });

    it('replaces an empty title with Sem título', () => {
      expect(renderReminder({ ...base, title: ' \n\t ' })).toBe('Prazo hoje, 27/10: Sem título');
      expect(renderReminder({ ...base, title: '' })).toBe('Prazo hoje, 27/10: Sem título');
    });

    it('the late suffix comes after the truncated title', () => {
      expect(renderReminder({ ...base, title: 'y'.repeat(300), late: true })).toBe(
        `Prazo hoje, 27/10: ${'y'.repeat(199)}… (atrasado)`,
      );
    });
  });
});

describe('isLate', () => {
  const scheduled = new Date('2026-10-27T11:00:00Z');
  it('is false at exactly 5:00', () => {
    expect(isLate(scheduled, new Date('2026-10-27T11:05:00Z'))).toBe(false);
  });
  it('is true at 5:01', () => {
    expect(isLate(scheduled, new Date('2026-10-27T11:05:01Z'))).toBe(true);
  });
  it('is false when on time or in the future', () => {
    expect(isLate(scheduled, scheduled)).toBe(false);
    expect(isLate(new Date('2026-10-27T12:00:00Z'), scheduled)).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it.each<[number, number | null]>([
    [1, 60_000],
    [2, 300_000],
    [3, 900_000],
    [4, 3_600_000],
    [5, null],
    [6, null],
    [100, null],
  ])('attempt %i -> %s', (attempt, expected) => {
    expect(retryDelayMs(attempt)).toBe(expected);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('throws RangeError for %s', (attempt) => {
    expect(() => retryDelayMs(attempt)).toThrow(RangeError);
  });
});

describe('classifyTelegramError', () => {
  const permanent = (reason: string) => ({ kind: 'permanent', reason });

  it.each([
    'Forbidden: bot was blocked by the user',
    'Forbidden: user is deactivated',
    'Forbidden: bot was kicked from the group chat',
    'Forbidden: something unknown',
  ])('403 "%s" is permanent bot_bloqueado', (description) => {
    expect(classifyTelegramError(403, { error_code: 403, description })).toEqual(permanent('bot_bloqueado'));
  });

  it('403 with no body is still permanent bot_bloqueado', () => {
    expect(classifyTelegramError(403, null)).toEqual(permanent('bot_bloqueado'));
  });

  it('400 chat not found is permanent chat_inexistente (case-insensitive)', () => {
    expect(
      classifyTelegramError(400, { error_code: 400, description: 'Bad Request: chat not found' }),
    ).toEqual(permanent('chat_inexistente'));
    expect(classifyTelegramError(400, { description: 'Bad Request: CHAT NOT FOUND' })).toEqual(
      permanent('chat_inexistente'),
    );
  });

  it.each([
    "Bad Request: can't parse entities: Unsupported start tag",
    'Bad Request: message is too long',
  ])('400 "%s" is permanent outro', (description) => {
    expect(classifyTelegramError(400, { error_code: 400, description })).toEqual(permanent('outro'));
  });

  it('400 without body is permanent outro', () => {
    expect(classifyTelegramError(400, undefined)).toEqual(permanent('outro'));
  });

  it.each([401, 404, 418])('%i is permanent outro', (status) => {
    expect(classifyTelegramError(status, { error_code: status })).toEqual(permanent('outro'));
  });

  it('429 with retry_after 7 is transient with 7000 ms', () => {
    expect(
      classifyTelegramError(429, { error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 7 } }),
    ).toEqual({ kind: 'transient', retryAfterMs: 7000 });
  });

  it('429 without retry_after is transient with no retryAfterMs', () => {
    const r = classifyTelegramError(429, { error_code: 429 });
    expect(r).toEqual({ kind: 'transient' });
    expect('retryAfterMs' in r).toBe(false);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('429 with invalid retry_after %s has no retryAfterMs', (v) => {
    expect(classifyTelegramError(429, { parameters: { retry_after: v } })).toEqual({ kind: 'transient' });
  });

  it('429 with retry_after 0 gives 0 ms', () => {
    expect(classifyTelegramError(429, { parameters: { retry_after: 0 } })).toEqual({
      kind: 'transient',
      retryAfterMs: 0,
    });
  });

  it.each([0, 408, 500, 502, 503, 504, 599])('status %i is transient', (status) => {
    expect(classifyTelegramError(status, null)).toEqual({ kind: 'transient' });
  });

  it('never throws on garbage bodies', () => {
    const garbage = [
      'string',
      42,
      [],
      { description: 123 },
      { parameters: 'x' },
      { parameters: { retry_after: 'abc' } },
    ] as unknown as Array<Parameters<typeof classifyTelegramError>[1]>;
    for (const body of garbage) {
      for (const status of [0, 400, 403, 429, 500]) {
        expect(() => classifyTelegramError(status, body)).not.toThrow();
      }
    }
    expect(classifyTelegramError(429, { parameters: { retry_after: 'abc' } } as never)).toEqual({
      kind: 'transient',
    });
    expect(classifyTelegramError(400, { description: 123 } as never)).toEqual(permanent('outro'));
  });
});
