import type { IsoDate } from '@aj/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BriefingRepository } from '../application/ports.js';
import { briefingLocalDate } from '../domain/briefing-window.js';

type CandidateRow = {
  id: string;
  telegram_chat_id: number | string;
  timezone: string;
  briefing_time: string;
  last_briefing_sent_on: string | null;
};

export function createSupabaseBriefingRepository(client: SupabaseClient): BriefingRepository {
  return {
    async dueFor(now) {
      // Candidatos: vinculados e não pausados. A janela local é decidida em código, por fuso (Ruling 19).
      const { data, error } = await client
        .from('profiles')
        .select('id, telegram_chat_id, timezone, briefing_time, last_briefing_sent_on')
        .not('telegram_chat_id', 'is', null)
        .eq('channel_paused', false);
      if (error) throw new Error(`Falha ao listar destinatários do briefing: ${error.message}`);

      const out: Array<{ userId: string; chatId: number; timezone: string; localDate: IsoDate }> = [];
      for (const row of (data ?? []) as CandidateRow[]) {
        const localDate = briefingLocalDate(now, row.timezone, row.briefing_time);
        if (localDate === null) continue;
        if (row.last_briefing_sent_on !== null && row.last_briefing_sent_on >= localDate) continue;
        out.push({ userId: row.id, chatId: Number(row.telegram_chat_id), timezone: row.timezone, localDate });
      }
      return out;
    },

    async claim(userId, localDate) {
      const { data, error } = await client.rpc('claim_briefing', { p_user_id: userId, p_local_date: localDate });
      if (error) throw new Error(`Falha ao reservar o briefing: ${error.message}`);
      return data === true;
    },

    async release(userId, localDate) {
      const { error } = await client.rpc('release_briefing', { p_user_id: userId, p_local_date: localDate });
      if (error) throw new Error(`Falha ao desfazer a reserva do briefing: ${error.message}`);
    },
  };
}
