import type { SupabaseClient } from '@supabase/supabase-js';
import type { Holiday, HolidayDto, IsoDate } from '@nexus/shared';
import { ConflictError } from '../application/errors.js';
import type { HolidayAdminRepository, HolidayRepository } from '../application/ports.js';
import { INVALID_TEXT_REPRESENTATION, isUuid } from './mappers.js';

const UNIQUE_VIOLATION = '23505';

function holidayFromRow(row: Record<string, unknown>): HolidayDto {
  return {
    id: row.id as string,
    date: row.date as IsoDate,
    scope: row.scope as HolidayDto['scope'],
    name: row.name as string,
  };
}

export function createSupabaseHolidayRepository(
  client: SupabaseClient,
): HolidayRepository & HolidayAdminRepository {
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

    async list(userId) {
      const { data, error } = await client
        .from('holidays')
        .select('id, date, scope, name')
        .eq('user_id', userId)
        .order('date', { ascending: true });
      if (error) throw new Error(`Falha ao listar feriados: ${error.message}`);
      return (data ?? []).map(holidayFromRow);
    },

    async create(userId, input) {
      const { data, error } = await client
        .from('holidays')
        .insert({ user_id: userId, date: input.date, scope: input.scope, name: input.name })
        .select('id, date, scope, name')
        .single();
      if (error) {
        if (error.code === UNIQUE_VIOLATION) throw new ConflictError('feriado_ja_cadastrado');
        throw new Error(`Falha ao criar feriado: ${error.message}`);
      }
      return holidayFromRow(data);
    },

    async remove(userId, id) {
      if (!isUuid(id)) return false;
      const { data, error } = await client
        .from('holidays')
        .delete()
        .eq('user_id', userId)
        .eq('id', id)
        .select('id');
      if (error?.code === INVALID_TEXT_REPRESENTATION) return false;
      if (error) throw new Error(`Falha ao remover feriado: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
}
