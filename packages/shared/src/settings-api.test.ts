import { describe, expect, it } from 'vitest';
import { updateSettingsInputSchema } from './settings-api.js';
import { isValidTimeZone, timeOfDaySchema } from './time-of-day.js';

describe('timeOfDaySchema', () => {
  it.each(['09:30', '00:00', '23:59'])('accepts %s', (v) => {
    expect(timeOfDaySchema.safeParse(v).success).toBe(true);
  });
  it.each(['24:00', '9:30', '09:60', '09:30:00', ''])('rejects %s', (v) => {
    expect(timeOfDaySchema.safeParse(v).success).toBe(false);
  });
});

describe('isValidTimeZone', () => {
  it('accepts real zones and rejects garbage without throwing', () => {
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('Nao/Existe')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('\u0000??')).toBe(false);
  });
});

describe('updateSettingsInputSchema', () => {
  it('requires at least one field', () => {
    expect(updateSettingsInputSchema.safeParse({}).success).toBe(false);
  });
  it('bounds earlyReminderMinutes', () => {
    expect(updateSettingsInputSchema.safeParse({ earlyReminderMinutes: -1 }).success).toBe(false);
    expect(updateSettingsInputSchema.safeParse({ earlyReminderMinutes: 1441 }).success).toBe(false);
    expect(updateSettingsInputSchema.safeParse({ earlyReminderMinutes: 0 }).success).toBe(true);
    expect(updateSettingsInputSchema.safeParse({ earlyReminderMinutes: 1440 }).success).toBe(true);
  });
  it('validates timezone and briefingTime', () => {
    expect(updateSettingsInputSchema.safeParse({ timezone: 'Nao/Existe' }).success).toBe(false);
    expect(updateSettingsInputSchema.safeParse({ timezone: 'America/Sao_Paulo' }).success).toBe(true);
    expect(updateSettingsInputSchema.safeParse({ briefingTime: '08:00' }).success).toBe(true);
    expect(updateSettingsInputSchema.safeParse({ briefingTime: '8:00' }).success).toBe(false);
  });
});
