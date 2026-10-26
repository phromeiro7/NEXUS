import type { SupabaseClient } from '@supabase/supabase-js';
import type { Holiday, IsoDate } from '@aj/shared';
import type { HolidayRepository } from '../application/ports.js';

export function createSupabaseHolidayRepository(client: SupabaseClient): HolidayRepository {
  return {
    async listByUser(userId, from, to) {
      const { data, error } = await client
        .from('holidays')
        .select('date, name')
        .eq('user_id', userId)
        .gte('date', from)
        .lte('date', to)
        .order('date');
      if (error) throw new Error(`Falha ao listar feriados: ${error.message}`);
      return (data ?? []).map((row): Holiday => ({ date: row.date as IsoDate, name: row.name as string }));
    },
  };
}
