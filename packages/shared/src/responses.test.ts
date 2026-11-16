import { describe, expect, it } from 'vitest';
import type { MeDto, UpdateSettingsResultDto } from './index';

describe('response DTOs', () => {
  it('UpdateSettingsResultDto carries the skipped tasks with their reason', () => {
    const result: UpdateSettingsResultDto = {
      settings: {
        timezone: 'America/New_York',
        earlyReminderMinutes: 15,
        briefingTime: '08:00',
        telegramLinked: false,
        channelPaused: false,
      },
      remindersRebuilt: 1,
      remindersSkipped: 1,
      skipped: [{ id: 'b8a1c0de-0000-4000-8000-000000000001', title: 'Reunião', reason: 'hora_inexistente' }],
    };
    expect(result.remindersSkipped).toBe(result.skipped.length);
    // @ts-expect-error reason só aceita os dois motivos de hora inválida
    const bad: UpdateSettingsResultDto['skipped'][number] = { id: 'x', title: 't', reason: 'outro' };
    expect(bad).toBeDefined();
  });

  it('MeDto has the API shape', () => {
    const me: MeDto = { userId: 'u1' };
    expect(me.userId).toBe('u1');
  });
});
