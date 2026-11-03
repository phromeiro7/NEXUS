import type { SettingsDto } from '@aj/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProfileRepository } from '../application/ports.js';
import { definedOnly, toHourMinute } from './mappers.js';

const COLUMNS = 'timezone, uf, city, early_reminder_minutes, briefing_time, telegram_chat_id, channel_paused';

function settingsFromRow(row: Record<string, unknown>): SettingsDto {
  return {
    timezone: row.timezone as string,
    uf: row.uf as string | null,
    city: row.city as string | null,
    earlyReminderMinutes: row.early_reminder_minutes as number,
    briefingTime: toHourMinute(row.briefing_time)!,
    telegramLinked: row.telegram_chat_id !== null && row.telegram_chat_id !== undefined,
    channelPaused: row.channel_paused === true,
  };
}

export function createSupabaseProfileRepository(client: SupabaseClient): ProfileRepository {
  const get: ProfileRepository['get'] = async (userId) => {
    const { data, error } = await client.from('profiles').select(COLUMNS).eq('id', userId).maybeSingle();
    if (error) throw new Error(`Falha ao ler configurações: ${error.message}`);
    if (!data) throw new Error('Falha ao ler configurações: perfil não encontrado');
    return settingsFromRow(data);
  };

  return {
    get,

    async update(userId, patch) {
      const values = definedOnly({
        timezone: patch.timezone,
        uf: patch.uf,
        city: patch.city,
        early_reminder_minutes: patch.earlyReminderMinutes,
        briefing_time: patch.briefingTime,
      });
      if (Object.keys(values).length === 0) return get(userId);
      const { data, error } = await client
        .from('profiles')
        .update(values)
        .eq('id', userId)
        .select(COLUMNS)
        .maybeSingle();
      if (error) throw new Error(`Falha ao atualizar configurações: ${error.message}`);
      if (!data) throw new Error('Falha ao atualizar configurações: perfil não encontrado');
      return settingsFromRow(data);
    },
  };
}
