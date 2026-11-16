import { describe, expect, it } from 'vitest';
import { anon, buildApp, newTask, req } from '../../test/harness.js';

const defaults = {
  timezone: 'America/Sao_Paulo',
  earlyReminderMinutes: 15,
  briefingTime: '08:00',
  telegramLinked: false,
  channelPaused: false,
};

describe('settings routes', () => {
  it.each([
    ['GET', '/settings'],
    ['PATCH', '/settings'],
  ])('%s %s without token is 401, even with an invalid body', async (method, path) => {
    const { app } = buildApp();
    const res = await anon(app, method, path, method === 'PATCH' ? '{nope' : undefined);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'nao_autenticado' });
  });

  it('GET returns the exact SettingsDto defaults', async () => {
    const res = await req(buildApp().app, 'GET', '/settings');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(defaults);
  });

  it('PATCH earlyReminderMinutes rebuilds reminders of open dated tasks', async () => {
    const { app, fakes } = buildApp();
    const t = await fakes.tasks.create('u1', newTask('Audiencia', { dueDate: '2026-10-30', dueTime: '10:00' }));
    expect(fakes.reminders.remindersFor(t.id, 'u1')).toEqual([]);

    const res = await req(app, 'PATCH', '/settings', { earlyReminderMinutes: 30 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      settings: { ...defaults, earlyReminderMinutes: 30 },
      remindersRebuilt: 1,
      remindersSkipped: 0,
      skipped: [],
    });
    // 10:00 em Sao Paulo (UTC-3) = 13:00Z; 30 min antes = 12:30Z
    expect(fakes.reminders.remindersFor(t.id, 'u1')).toEqual([
      { kind: 'antecipado', scheduledAt: new Date('2026-10-30T12:30:00.000Z') },
      { kind: 'no_horario', scheduledAt: new Date('2026-10-30T13:00:00.000Z') },
    ]);
  });

  it('PATCH lists the tasks whose time is invalid in the new zone under skipped', async () => {
    const { app, fakes } = buildApp({ now: new Date('2026-03-01T12:00:00Z') });
    const gap = await fakes.tasks.create('u1', newTask('Reuniao', { dueDate: '2026-03-08', dueTime: '02:30' }));

    const res = await req(app, 'PATCH', '/settings', { timezone: 'America/New_York' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      settings: { ...defaults, timezone: 'America/New_York' },
      remindersRebuilt: 0,
      remindersSkipped: 1,
      skipped: [{ id: gap.id, title: 'Reuniao', reason: 'hora_inexistente' }],
    });
  });

  it('PATCH changes only the caller settings', async () => {
    const { app } = buildApp();
    await req(app, 'PATCH', '/settings', { earlyReminderMinutes: 45 }, 'token-u2');
    const mine = await req(app, 'GET', '/settings');
    expect(await mine.json()).toEqual(defaults);
    const theirs = await req(app, 'GET', '/settings', undefined, 'token-u2');
    expect(await theirs.json()).toEqual({ ...defaults, earlyReminderMinutes: 45 });
  });

  it.each([{ timezone: 'Nao/Existe' }, { earlyReminderMinutes: -1 }, {}, '{nope'])('PATCH with invalid body %j is 400', async (body) => {
    const res = await req(buildApp().app, 'PATCH', '/settings', body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('entrada_invalida');
  });

  it('userId cannot be overridden by body or query', async () => {
    const { app } = buildApp();
    const res = await req(app, 'PATCH', '/settings?userId=u2', { earlyReminderMinutes: 20, userId: 'u2' });
    expect(res.status).toBe(200);
    const u2 = await req(app, 'GET', '/settings?userId=u1', undefined, 'token-u2');
    expect(await u2.json()).toEqual(defaults);
    const u1 = await req(app, 'GET', '/settings');
    expect(((await u1.json()) as { earlyReminderMinutes: number }).earlyReminderMinutes).toBe(20);
  });
});
