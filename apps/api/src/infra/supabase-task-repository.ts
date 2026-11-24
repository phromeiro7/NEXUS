import type { SupabaseClient } from '@supabase/supabase-js';
import type { NewTask, TaskPatch, TaskRepository } from '../application/ports.js';
import { INVALID_TEXT_REPRESENTATION, TASK_COLUMNS, definedOnly, isUuid, taskFromRow } from './mappers.js';

/** Campos da tarefa -> colunas de `tasks`, sem os ausentes (`undefined` não sobrescreve). */
function columnsOf(patch: TaskPatch) {
  return definedOnly({
    title: patch.title,
    type: patch.type,
    status: patch.status,
    due_date: patch.dueDate,
    due_time: patch.dueTime,
    fatal: patch.fatal,
    completed_at: patch.completedAt,
  });
}

/**
 * Tarefas. Toda consulta filtra por `user_id` (o cliente usa a service role, que ignora RLS) e ignora
 * as apagadas (`deleted_at` preenchido: exclusão lógica). Id malformado vira "não encontrado".
 */
export function createSupabaseTaskRepository(client: SupabaseClient): TaskRepository {
  const get: TaskRepository['get'] = async (userId, id) => {
    if (!isUuid(id)) return null;
    const { data, error } = await client
      .from('tasks')
      .select(TASK_COLUMNS)
      .eq('user_id', userId)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error?.code === INVALID_TEXT_REPRESENTATION) return null;
    if (error) throw new Error(`Falha ao buscar tarefa: ${error.message}`);
    return data ? taskFromRow(data) : null;
  };

  return {
    async create(userId, task: NewTask) {
      const { data, error } = await client
        .from('tasks')
        .insert({
          ...columnsOf(task),
          user_id: userId,
          source: task.source,
          source_text: task.sourceText,
        })
        .select(TASK_COLUMNS)
        .single();
      if (error) throw new Error(`Falha ao criar tarefa: ${error.message}`);
      return taskFromRow(data);
    },

    get,

    async list(userId, query) {
      let request = client.from('tasks').select(TASK_COLUMNS).eq('user_id', userId).is('deleted_at', null);
      if (query.from !== undefined) request = request.gte('due_date', query.from);
      if (query.to !== undefined) request = request.lte('due_date', query.to);
      if (query.status && query.status.length > 0) request = request.in('status', query.status);
      if (query.withoutDate === true) request = request.is('due_date', null);
      // Com data primeiro (as sem data no fim); `id` desempata para a ordem ser estável.
      const { data, error } = await request
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('due_time', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
      if (error) throw new Error(`Falha ao listar tarefas: ${error.message}`);
      return (data ?? []).map(taskFromRow);
    },

    async update(userId, id, patch) {
      if (!isUuid(id)) return null;
      const changedColumns = columnsOf(patch);
      // Nada para mudar: devolve a tarefa atual sem escrever.
      if (Object.keys(changedColumns).length === 0) return get(userId, id);
      const { data, error } = await client
        .from('tasks')
        .update(changedColumns)
        .eq('user_id', userId)
        .eq('id', id)
        .is('deleted_at', null)
        .select(TASK_COLUMNS)
        .maybeSingle();
      if (error?.code === INVALID_TEXT_REPRESENTATION) return null;
      if (error) throw new Error(`Falha ao atualizar tarefa: ${error.message}`);
      return data ? taskFromRow(data) : null;
    },

    async softDelete(userId, id, now) {
      if (!isUuid(id)) return false;
      const { data, error } = await client
        .from('tasks')
        .update({ deleted_at: now.toISOString() })
        .eq('user_id', userId)
        .eq('id', id)
        .is('deleted_at', null)
        .select('id');
      if (error?.code === INVALID_TEXT_REPRESENTATION) return false;
      if (error) throw new Error(`Falha ao apagar tarefa: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
}
