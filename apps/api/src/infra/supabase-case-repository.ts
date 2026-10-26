import type { SupabaseClient } from '@supabase/supabase-js';
import { ConflictError } from '../application/errors.js';
import type { CaseRepository } from '../application/ports.js';
import { CASE_COLUMNS, caseFromRow, definedOnly } from './mappers.js';

const UNIQUE_VIOLATION = '23505';

export function createSupabaseCaseRepository(client: SupabaseClient): CaseRepository {
  const get: CaseRepository['get'] = async (userId, id) => {
    const { data, error } = await client
      .from('cases')
      .select(CASE_COLUMNS)
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Falha ao buscar processo: ${error.message}`);
    return data ? caseFromRow(data) : null;
  };

  return {
    async create(userId, input) {
      const { data, error } = await client
        .from('cases')
        .insert({
          user_id: userId,
          number: input.number,
          client_name: input.clientName ?? null,
          description: input.description ?? null,
        })
        .select(CASE_COLUMNS)
        .single();
      if (error) {
        if (error.code === UNIQUE_VIOLATION) throw new ConflictError('numero_ja_cadastrado');
        throw new Error(`Falha ao criar processo: ${error.message}`);
      }
      return caseFromRow(data);
    },

    get,

    async list(userId, filter) {
      let q = client.from('cases').select(CASE_COLUMNS).eq('user_id', userId);
      if (filter.status !== undefined) q = q.eq('status', filter.status);
      const { data, error } = await q.order('created_at', { ascending: true }).order('id', { ascending: true });
      if (error) throw new Error(`Falha ao listar processos: ${error.message}`);
      return (data ?? []).map(caseFromRow);
    },

    async update(userId, id, patch) {
      const values = definedOnly({
        number: patch.number,
        client_name: patch.clientName,
        description: patch.description,
        status: patch.status,
      });
      if (Object.keys(values).length === 0) return get(userId, id);
      const { data, error } = await client
        .from('cases')
        .update(values)
        .eq('user_id', userId)
        .eq('id', id)
        .select(CASE_COLUMNS)
        .maybeSingle();
      if (error) {
        if (error.code === UNIQUE_VIOLATION) throw new ConflictError('numero_ja_cadastrado');
        throw new Error(`Falha ao atualizar processo: ${error.message}`);
      }
      return data ? caseFromRow(data) : null;
    },
  };
}
