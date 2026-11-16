import type { TaskDto } from '@nexus/shared';
import { describe, expect, it } from 'vitest';
import { TELEGRAM_MAX_CHARS, formatAssistantReply, formatTaskLine } from './reply-format.js';

function task(p: Partial<TaskDto>): TaskDto {
  return {
    id: 'id',
    caseId: null,
    title: 'Reunião',
    type: 'tarefa',
    status: 'pendente',
    dueDate: '2026-10-28',
    dueTime: '14:00',
    fatal: false,
    baseDate: null,
    periodDays: null,
    countType: null,
    completedAt: null,
    createdAt: '2026-10-26T12:00:00.000Z',
    updatedAt: '2026-10-26T12:00:00.000Z',
    ...p,
  };
}

describe('formatTaskLine', () => {
  it('weekday abbreviation, dd/MM and time', () => {
    expect(formatTaskLine(task({}))).toBe('• Reunião — qua, 28/10, 14:00');
  });

  it('covers every weekday abbreviation', () => {
    const days: Array<[string, string]> = [
      ['2026-10-25', 'dom'],
      ['2026-10-26', 'seg'],
      ['2026-10-27', 'ter'],
      ['2026-10-28', 'qua'],
      ['2026-10-29', 'qui'],
      ['2026-10-30', 'sex'],
      ['2026-10-31', 'sáb'],
    ];
    for (const [date, wd] of days) {
      expect(formatTaskLine(task({ dueDate: date as TaskDto['dueDate'] }))).toBe(`• Reunião — ${wd}, ${date.slice(8)}/10, 14:00`);
    }
  });

  it('a task with a date and no time is all-day', () => {
    expect(formatTaskLine(task({ dueTime: null }))).toBe('• Reunião — qua, 28/10, dia inteiro');
  });

  it('a task without a date', () => {
    expect(formatTaskLine(task({ dueDate: null, dueTime: null }))).toBe('• Reunião — sem data');
  });

  it('zero-pads day and month', () => {
    expect(formatTaskLine(task({ dueDate: '2027-01-05', dueTime: '09:05' }))).toBe('• Reunião — ter, 05/01, 09:05');
  });

  it('collapses a multi-line title into one line', () => {
    expect(formatTaskLine(task({ title: 'Linha 1\n\n  Linha 2\r\nLinha 3' }))).toBe(
      '• Linha 1 Linha 2 Linha 3 — qua, 28/10, 14:00',
    );
  });

  it('truncates a very long title to 200 characters and never leaves it empty', () => {
    const line = formatTaskLine(task({ title: 'x'.repeat(300) }));
    expect(line).toBe(`• ${'x'.repeat(199)}… — qua, 28/10, 14:00`);
    expect(formatTaskLine(task({ title: '   ' }))).toBe('• Sem título — qua, 28/10, 14:00');
  });
});

describe('formatAssistantReply', () => {
  it('is the reply alone when no task was affected', () => {
    expect(formatAssistantReply('Olá!', [])).toBe('Olá!');
  });

  it('appends a blank line and one line per affected task, in order', () => {
    const text = formatAssistantReply('Anotei.', [
      task({ title: 'A' }),
      task({ title: 'B', dueDate: null, dueTime: null }),
    ]);
    expect(text).toBe('Anotei.\n\n• A — qua, 28/10, 14:00\n• B — sem data');
  });

  it('never exceeds 4096 characters: the reply is cut with an ellipsis and the task lines survive', () => {
    const text = formatAssistantReply('r'.repeat(6000), [task({ title: 'Importante' })]);
    const line = '• Importante — qua, 28/10, 14:00';
    expect(Array.from(text).length).toBeLessThanOrEqual(TELEGRAM_MAX_CHARS);
    expect(text.endsWith(`…\n\n${line}`)).toBe(true);
  });

  it('cuts a reply alone at exactly 4096 code points, never splitting an emoji', () => {
    const text = formatAssistantReply('😀'.repeat(5000), []);
    expect(Array.from(text)).toHaveLength(TELEGRAM_MAX_CHARS);
    expect(text.endsWith('😀…')).toBe(true);
  });

  it('a text of exactly 4096 characters is untouched', () => {
    const exact = 'a'.repeat(TELEGRAM_MAX_CHARS);
    expect(formatAssistantReply(exact, [])).toBe(exact);
  });
});
