import { describe, expect, it } from 'vitest';
import { anon, buildApp, newTask, req } from '../../test/harness.js';

describe('briefing route', () => {
  it('GET without token is 401', async () => {
    const res = await anon(buildApp().app, 'GET', '/briefing');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'nao_autenticado' });
  });

  it('returns the four lists with exact ids, only for the caller, and today in the profile time zone', async () => {
    // 01:30Z de 27/10 ainda e 26/10 em Sao Paulo.
    const { app, fakes } = buildApp({ now: new Date('2026-10-27T01:30:00Z') });
    const late = await fakes.tasks.create('u1', newTask('late', { dueDate: '2026-10-25' }));
    const fatal = await fakes.tasks.create('u1', newTask('fatal', { dueDate: '2026-10-26', fatal: true }));
    const hear = await fakes.tasks.create('u1', newTask('hear', { dueDate: '2026-10-26', type: 'audiencia' }));
    const next = await fakes.tasks.create('u1', newTask('next', { dueDate: '2026-10-28' }));
    await fakes.tasks.create('u1', newTask('far', { dueDate: '2026-10-29' }));
    await fakes.tasks.create('u2', newTask('theirs', { dueDate: '2026-10-26', fatal: true }));

    const res = await req(app, 'GET', '/briefing');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const ids = (l: unknown) => (l as { id: string }[]).map((t) => t.id);
    expect(Object.keys(body).sort()).toEqual(['fatalToday', 'hearingsToday', 'nextTwoDays', 'overdue', 'today']);
    expect(body.today).toBe('2026-10-26');
    expect(ids(body.overdue)).toEqual([late.id]);
    expect(ids(body.fatalToday)).toEqual([fatal.id]);
    expect(ids(body.hearingsToday)).toEqual([hear.id]);
    expect(ids(body.nextTwoDays)).toEqual([next.id]);
  });

  it('userId cannot be overridden by query', async () => {
    const { app, fakes } = buildApp();
    await fakes.tasks.create('u1', newTask('mine', { dueDate: '2026-10-26', fatal: true }));
    const theirs = await fakes.tasks.create('u2', newTask('theirs', { dueDate: '2026-10-26', fatal: true }));
    const res = await req(app, 'GET', '/briefing?userId=u2');
    const body = (await res.json()) as { fatalToday: { id: string; title: string }[] };
    expect(body.fatalToday.map((t) => t.title)).toEqual(['mine']);
    expect(body.fatalToday.map((t) => t.id)).not.toContain(theirs.id);
  });
});
