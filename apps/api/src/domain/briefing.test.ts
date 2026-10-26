import { describe, expect, it } from 'vitest';
import { buildBriefing } from './briefing.js';

type Row = {
  id: string;
  status: 'pendente' | 'em_andamento' | 'concluida' | 'cancelada';
  dueDate: string | null;
  dueTime: string | null;
  fatal: boolean;
  type: 'prazo' | 'tarefa' | 'audiencia';
};

const row = (id: string, p: Partial<Row> = {}): Row => ({
  id,
  status: 'pendente',
  dueDate: '2026-10-26',
  dueTime: null,
  fatal: false,
  type: 'tarefa',
  ...p,
});
const ids = (l: Row[]) => l.map((t) => t.id);
const TODAY = '2026-10-26';

describe('buildBriefing', () => {
  it('separates overdue, fatal today, hearing today and the next two days', () => {
    const b = buildBriefing(
      [
        row('late', { dueDate: '2026-10-25' }),
        row('fatal', { fatal: true, type: 'prazo' }),
        row('hear', { type: 'audiencia' }),
        row('plain-today'),
        row('d1', { dueDate: '2026-10-27' }),
        row('d2', { dueDate: '2026-10-28', status: 'em_andamento' }),
        row('d3', { dueDate: '2026-10-29' }),
        row('nodate', { dueDate: null }),
      ],
      TODAY,
    );
    expect(ids(b.overdue)).toEqual(['late']);
    expect(ids(b.fatalToday)).toEqual(['fatal']);
    expect(ids(b.hearingsToday)).toEqual(['hear']);
    expect(ids(b.nextTwoDays)).toEqual(['d1', 'd2']);
  });

  it('leaves closed tasks out of every list', () => {
    const b = buildBriefing(
      [
        row('c1', { status: 'concluida', dueDate: '2026-10-25', fatal: true, type: 'audiencia' }),
        row('c2', { status: 'cancelada', dueDate: '2026-10-26', fatal: true, type: 'audiencia' }),
        row('c3', { status: 'concluida', dueDate: '2026-10-27' }),
      ],
      TODAY,
    );
    expect(b).toEqual({ overdue: [], fatalToday: [], hearingsToday: [], nextTwoDays: [] });
  });

  it('orders by date, then time, tasks without time last, stable', () => {
    const b = buildBriefing(
      [
        row('b-none', { dueDate: '2026-10-27' }),
        row('b-1400', { dueDate: '2026-10-27', dueTime: '14:00' }),
        row('a-none-2', { dueDate: '2026-10-28' }),
        row('b-0900', { dueDate: '2026-10-27', dueTime: '09:00' }),
        row('a-none-1', { dueDate: '2026-10-28' }),
        row('o2', { dueDate: '2026-10-25' }),
        row('o1', { dueDate: '2026-10-24', dueTime: '18:00' }),
        row('o3', { dueDate: '2026-10-25', dueTime: '08:00' }),
      ],
      TODAY,
    );
    expect(ids(b.nextTwoDays)).toEqual(['b-0900', 'b-1400', 'b-none', 'a-none-2', 'a-none-1']);
    expect(ids(b.overdue)).toEqual(['o1', 'o3', 'o2']);
  });

  it('orders today lists by time too', () => {
    const b = buildBriefing(
      [
        row('h-none', { type: 'audiencia' }),
        row('h-1500', { type: 'audiencia', dueTime: '15:00' }),
        row('h-0900', { type: 'audiencia', dueTime: '09:00' }),
        row('f-1', { fatal: true }),
        row('f-0', { fatal: true, dueTime: '07:00' }),
      ],
      TODAY,
    );
    expect(ids(b.hearingsToday)).toEqual(['h-0900', 'h-1500', 'h-none']);
    expect(ids(b.fatalToday)).toEqual(['f-0', 'f-1']);
  });

  it('a fatal hearing appears in both lists; a fatal overdue one only in overdue', () => {
    const b = buildBriefing(
      [row('fh', { fatal: true, type: 'audiencia' }), row('fo', { fatal: true, dueDate: '2026-10-25' })],
      TODAY,
    );
    expect(ids(b.fatalToday)).toEqual(['fh']);
    expect(ids(b.hearingsToday)).toEqual(['fh']);
    expect(ids(b.overdue)).toEqual(['fo']);
    expect(b.nextTwoDays).toEqual([]);
  });

  it('nextTwoDays window crosses month boundaries', () => {
    const b = buildBriefing(
      [row('a', { dueDate: '2026-11-01' }), row('b', { dueDate: '2026-11-02' }), row('c', { dueDate: '2026-11-03' })],
      '2026-10-31',
    );
    expect(ids(b.nextTwoDays)).toEqual(['a', 'b']);
  });
});
