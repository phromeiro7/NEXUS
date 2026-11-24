import type { SettingsDto } from '@nexus/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProfileRepository } from '../application/ports.js';
import { omitUndefined, toHourMinute } from './mappers.js';

const SETTINGS_COLUMNS = 'timezone, early_reminder_minutes, briefing_time, telegram_chat_id, channel_paused';

/** Linha de `profiles` -> configurações do usuário (o chat em si nunca sai daqui, só se está vinculado). */
function settingsFromRow(row: Record<string, unknown>): SettingsDto {
  return {
    timezone: row.timezone as string,
    earlyReminderMinutes: row.early_reminder_minutes as number,
    briefingTime: toHourMinute(row.briefing_time)!,
    telegramLinked: row.telegram_chat_id !== null && row.telegram_chat_id !== undefined,
    channelPaused: row.channel_paused === true,
  };
}

/** Configurações do usuário guardadas em `profiles` (uma linha por conta, `id` = id do usuário). */
export function createSupabaseProfileRepository(client: SupabaseClient): ProfileRepository {
  const get: ProfileRepository['get'] = async (userId) => {
    const { data, error } = await client.from('profiles').select(SETTINGS_COLUMNS).eq('id', userId).maybeSingle();
    if (error) throw new Error(`Falha ao ler configurações: ${error.message}`);
    if (!data) throw new Error('Falha ao ler configurações: perfil não encontrado');
    return settingsFromRow(data);
  };

  return {
    get,

    async update(userId, patch) {
      const changedColumns = omitUndefined({
        timezone: patch.timezone,
        early_reminder_minutes: patch.earlyReminderMinutes,
        briefing_time: patch.briefingTime,
      });
      // Nada para mudar: devolve o estado atual sem escrever.
      if (Object.keys(changedColumns).length === 0) return get(userId);
      const { data, error } = await client
        .from('profiles')
        .update(changedColumns)
        .eq('id', userId)
        .select(SETTINGS_COLUMNS)
        .maybeSingle();
      if (error) throw new Error(`Falha ao atualizar configurações: ${error.message}`);
      if (!data) throw new Error('Falha ao atualizar configurações: perfil não encontrado');
      return settingsFromRow(data);
    },
  };
}
