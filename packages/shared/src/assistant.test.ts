import { describe, expect, it } from 'vitest';
import { assistantMessageInputSchema, renderBriefing } from './assistant.js';
import type { BriefingDto } from './briefing.js';
import type { TaskDto } from './task-api.js';

const UUID = '3f2b8c1e-5d4a-4b7e-9a10-2c6d8e4f1a77';

function task(over: Partial<TaskDto>): TaskDto {
  return {
    id: 'id-1',
    caseId: null,
    title: 'Título',
    type: 'tarefa',
    status: 'pendente',
    dueDate: '2026-10-27',
    dueTime: null,
    fatal: false,
    baseDate: null,
    periodDays: null,
    countType: null,
    completedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

function briefing(over: Partial<BriefingDto>): BriefingDto {
  return {
    today: '2026-10-27',
    overdue: [],
    fatalToday: [],
    hearingsToday: [],
    nextTwoDays: [],
    ...over,
  };
}

describe('assistantMessageInputSchema', () => {
  it('accepts a valid message and trims the text', () => {
    const r = assistantMessageInputSchema.parse({ text: '  oi  ', clientMessageId: UUID });
    expect(r.text).toBe('oi');
  });

  it('accepts exactly 1000 characters', () => {
    expect(
      assistantMessageInputSchema.safeParse({ text: 'a'.repeat(1000), clientMessageId: UUID }).success,
    ).toBe(true);
  });

  it('rejects 1001 characters', () => {
    expect(
      assistantMessageInputSchema.safeParse({ text: 'a'.repeat(1001), clientMessageId: UUID }).success,
    ).toBe(false);
  });

  it('rejects whitespace-only text', () => {
    expect(assistantMessageInputSchema.safeParse({ text: '   \n\t ', clientMessageId: UUID }).success).toBe(
      false,
    );
  });

  it('rejects an invalid clientMessageId', () => {
    expect(assistantMessageInputSchema.safeParse({ text: 'oi', clientMessageId: 'abc' }).success).toBe(false);
  });

  it('rejects a missing clientMessageId', () => {
    expect(assistantMessageInputSchema.safeParse({ text: 'oi' }).success).toBe(false);
  });
});

describe('renderBriefing', () => {
  it('returns an empty string when all four lists are empty', () => {
    expect(renderBriefing(briefing({}))).toBe('');
  });

  it('renders the greeting with the long pt-BR date', () => {
    const text = renderBriefing(briefing({ nextTwoDays: [task({ dueDate: '2026-10-28' })] }));
    expect(text.split('\n')[0]).toBe('Bom dia.');
    expect(text.split('\n')[1]).toBe('terça-feira, 27 de outubro de 2026');
  });

  it('renders an overdue item and a 14:30 hearing, omitting empty sections', () => {
    const text = renderBriefing(
      briefing({
        overdue: [task({ title: 'Réplica', type: 'prazo', dueDate: '2026-10-24' })],
        hearingsToday: [task({ title: 'Instrução', type: 'audiencia', dueTime: '14:30' })],
      }),
    );
    expect(text).toContain('Atrasadas (1)');
    expect(text).toContain('• 24/10 — Réplica (Prazo)');
    expect(text).toContain('Audiências de hoje (1)');
    expect(text).toContain('• 14:30 — Instrução (Audiência)');
    expect(text).not.toContain('Fatais de hoje');
    expect(text).not.toContain('Próximas 48 horas');
  });

  it('marks fatal items with "fatal"', () => {
    const text = renderBriefing(
      briefing({ fatalToday: [task({ title: 'Recurso', type: 'prazo', fatal: true })] }),
    );
    expect(text).toContain('Fatais de hoje (1)');
    expect(text).toContain('• Recurso (Prazo, fatal)');
  });

  it('shows the time before the dash for timed fatal items', () => {
    const text = renderBriefing(
      briefing({ fatalToday: [task({ title: 'Recurso', type: 'prazo', fatal: true, dueTime: '09:00' })] }),
    );
    expect(text).toContain('• 09:00 — Recurso (Prazo, fatal)');
  });

  it('keeps a fixed section order', () => {
    const text = renderBriefing(
      briefing({
        nextTwoDays: [task({ title: 'D', dueDate: '2026-10-28' })],
        hearingsToday: [task({ title: 'C', type: 'audiencia' })],
        fatalToday: [task({ title: 'B', type: 'prazo', fatal: true })],
        overdue: [task({ title: 'A', dueDate: '2026-10-20' })],
      }),
    );
    const idx = ['Atrasadas', 'Fatais de hoje', 'Audiências de hoje', 'Próximas 48 horas'].map((s) =>
      text.indexOf(s),
    );
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('renders next-48h items with dd/MM, and the time when present', () => {
    const text = renderBriefing(
      briefing({
        nextTwoDays: [
          task({ title: 'Minuta', dueDate: '2026-10-28' }),
          task({ title: 'Reunião', dueDate: '2026-10-29', dueTime: '10:00' }),
        ],
      }),
    );
    expect(text).toContain('Próximas 48 horas (2)');
    expect(text).toContain('• 28/10 — Minuta (Tarefa)');
    expect(text).toContain('• 29/10 10:00 — Reunião (Tarefa)');
  });

  it('keeps only the date for a timed item in the overdue section', () => {
    const text = renderBriefing(
      briefing({ overdue: [task({ title: 'Réplica', type: 'prazo', dueDate: '2026-10-24', dueTime: '16:00' })] }),
    );
    expect(text).toContain('• 24/10 — Réplica (Prazo)');
    expect(text).not.toContain('16:00');
  });

  it('lists several items per section in the given order, with the count', () => {
    const text = renderBriefing(
      briefing({
        overdue: [
          task({ title: 'Um', dueDate: '2026-10-20' }),
          task({ title: 'Dois', dueDate: '2026-10-21' }),
          task({ title: 'Três', dueDate: '2026-10-22' }),
        ],
      }),
    );
    expect(text).toContain('Atrasadas (3)');
    expect(text.indexOf('Um')).toBeLessThan(text.indexOf('Dois'));
    expect(text.indexOf('Dois')).toBeLessThan(text.indexOf('Três'));
  });

  it('separates sections with a blank line and has no trailing newline', () => {
    const text = renderBriefing(
      briefing({
        overdue: [task({ title: 'A', dueDate: '2026-10-20' })],
        fatalToday: [task({ title: 'B', fatal: true })],
      }),
    );
    expect(text).toBe(
      [
        'Bom dia.',
        'terça-feira, 27 de outubro de 2026',
        '',
        'Atrasadas (1)',
        '• 20/10 — A (Tarefa)',
        '',
        'Fatais de hoje (1)',
        '• B (Tarefa, fatal)',
      ].join('\n'),
    );
  });

  it('never contains a raw ISO date and uses no markdown or HTML', () => {
    const text = renderBriefing(
      briefing({
        overdue: [task({ dueDate: '2026-10-24', dueTime: '10:00' })],
        fatalToday: [task({ fatal: true })],
        hearingsToday: [task({ type: 'audiencia', dueTime: '14:30' })],
        nextTwoDays: [task({ dueDate: '2026-10-28' })],
      }),
    );
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/[*_`#<>]/);
  });
});
