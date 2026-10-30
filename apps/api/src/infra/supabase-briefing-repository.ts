import type { IsoDate } from '@aj/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BriefingRepository } from '../application/ports.js';
import type { RemindersLogger } from '../application/run-reminders.js';
import { briefingLocalDate } from '../domain/briefing-window.js';

type CandidateRow = {
  id: string;
  telegram_chat_id: number | string;
  timezone: string;
  briefing_time: string;
  last_briefing_sent_on: string | null;
};

/** Deve ficar <= `max_rows` do PostgREST (supabase/config.toml: 1000), senão páginas viram truncadas em silêncio. */
const DEFAULT_PAGE_SIZE = 500;

export function createSupabaseBriefingRepository(
  client: SupabaseClient,
  opts: { pageSize?: number; logger?: RemindersLogger } = {},
): BriefingRepository {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const logger = opts.logger;

  return {
    async dueFor(now) {
      const out: Array<{ userId: string; chatId: number; timezone: string; localDate: IsoDate }> = [];
      // Candidatos: vinculados e não pausados, em páginas ordenadas por id (ordem estável).
      // A janela local é decidida em código, por fuso (Ruling 19).
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await client
          .from('profiles')
          .select('id, telegram_chat_id, timezone, briefing_time, last_briefing_sent_on')
          .not('telegram_chat_id', 'is', null)
          .eq('channel_paused', false)
          .order('id')
          .range(from, from + pageSize - 1);
        if (error) throw new Error(`Falha ao listar destinatários do briefing: ${error.message}`);
        const rows = (data ?? []) as CandidateRow[];

        for (const row of rows) {
          let localDate: IsoDate | null;
          try {
            localDate = briefingLocalDate(now, row.timezone, row.briefing_time);
          } catch (err) {
            // Perfil com fuso/hora inválidos não pode derrubar o briefing dos demais.
            logger?.error('briefing.invalid_profile', {
              userId: row.id,
              errorName: err instanceof Error ? err.name : 'desconhecido',
            });
            continue;
          }
          if (localDate === null) continue;
          if (row.last_briefing_sent_on !== null && row.last_briefing_sent_on >= localDate) continue;
          out.push({ userId: row.id, chatId: Number(row.telegram_chat_id), timezone: row.timezone, localDate });
        }

        if (rows.length < pageSize) break;
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
