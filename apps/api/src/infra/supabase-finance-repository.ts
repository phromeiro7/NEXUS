import type { SupabaseClient } from '@supabase/supabase-js';
import { ConflictError } from '../application/errors.js';
import { FINANCE_LIST_LIMIT, type FinanceEntryRepository } from '../application/ports.js';
import {
  FINANCE_COLUMNS,
  INVALID_TEXT_REPRESENTATION,
  omitUndefined,
  UNIQUE_VIOLATION,
  financeEntryFromRow,
  isUuid,
} from './mappers.js';

/**
 * Lançamentos financeiros. Toda consulta filtra por `user_id` (o cliente usa a service role, que ignora RLS);
 * id malformado vira "não encontrado" antes de chegar ao banco.
 */
export function createSupabaseFinanceRepository(client: SupabaseClient): FinanceEntryRepository {
  return {
    async create(userId, entry) {
      const { data, error } = await client
        .from('finance_entries')
        .insert({
          ...omitUndefined({ id: entry.id }),
          user_id: userId,
          kind: entry.kind,
          description: entry.description,
          amount_cents: entry.amountCents,
          category: entry.category,
          due_date: entry.dueDate,
          status: entry.status,
          reminder_time: entry.reminderTime,
          paid_at: entry.paidAt,
        })
        .select(FINANCE_COLUMNS)
        .single();
      if (error) {
        if (error.code === UNIQUE_VIOLATION) throw new ConflictError('lancamento_ja_cadastrado');
        throw new Error(`Falha ao criar lançamento: ${error.message}`);
      }
      return financeEntryFromRow(data);
    },

    async get(userId, id) {
      if (!isUuid(id)) return null;
      const { data, error } = await client
        .from('finance_entries')
        .select(FINANCE_COLUMNS)
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle();
      if (error?.code === INVALID_TEXT_REPRESENTATION) return null;
      if (error) throw new Error(`Falha ao buscar lançamento: ${error.message}`);
      return data ? financeEntryFromRow(data) : null;
    },

    async list(userId, query) {
      let request = client.from('finance_entries').select(FINANCE_COLUMNS).eq('user_id', userId);
      if (query.from !== undefined) request = request.gte('due_date', query.from);
      if (query.to !== undefined) request = request.lte('due_date', query.to);
      if (query.status !== undefined) request = request.eq('status', query.status);
      const { data, error } = await request
        .order('due_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(FINANCE_LIST_LIMIT);
      if (error) throw new Error(`Falha ao listar lançamentos: ${error.message}`);
      return (data ?? []).map(financeEntryFromRow);
    },

    async update(userId, id, patch) {
      if (!isUuid(id)) return null;
      const columns = omitUndefined({
        description: patch.description,
        amount_cents: patch.amountCents,
        category: patch.category,
        due_date: patch.dueDate,
        status: patch.status,
        reminder_time: patch.reminderTime,
        paid_at: patch.paidAt,
      });
      const { data, error } = await client
        .from('finance_entries')
        .update(columns)
        .eq('user_id', userId)
        .eq('id', id)
        .select(FINANCE_COLUMNS)
        .maybeSingle();
      if (error?.code === INVALID_TEXT_REPRESENTATION) return null;
      if (error) throw new Error(`Falha ao atualizar lançamento: ${error.message}`);
      return data ? financeEntryFromRow(data) : null;
    },

    async remove(userId, id) {
      if (!isUuid(id)) return false;
      const { data, error } = await client
        .from('finance_entries')
        .delete()
        .eq('user_id', userId)
        .eq('id', id)
        .select('id');
      if (error?.code === INVALID_TEXT_REPRESENTATION) return false;
      if (error) throw new Error(`Falha ao remover lançamento: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
}
