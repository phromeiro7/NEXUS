import type { SupabaseClient } from '@supabase/supabase-js';
import type { NewTask, TaskPatch, TaskRepository } from '../application/ports.js';
import { INVALID_TEXT_REPRESENTATION, TASK_COLUMNS, definedOnly, isUuid, taskFromRow } from './mappers.js';

function columnsOf(p: TaskPatch) {
  return definedOnly({
    case_id: p.caseId,
    title: p.title,
    type: p.type,
    status: p.status,
    due_date: p.dueDate,
    due_time: p.dueTime,
    fatal: p.fatal,
    base_date: p.baseDate,
    period_days: p.periodDays,
    count_type: p.countType,
    completed_at: p.completedAt,
  });
}

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
      if (query.caseId !== undefined && !isUuid(query.caseId)) return [];
      let q = client.from('tasks').select(TASK_COLUMNS).eq('user_id', userId).is('deleted_at', null);
      if (query.from !== undefined) q = q.gte('due_date', query.from);
      if (query.to !== undefined) q = q.lte('due_date', query.to);
      if (query.status && query.status.length > 0) q = q.in('status', query.status);
      if (query.caseId !== undefined) q = q.eq('case_id', query.caseId);
      if (query.withoutDate === true) q = q.is('due_date', null);
      const { data, error } = await q
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('due_time', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
      if (error) throw new Error(`Falha ao listar tarefas: ${error.message}`);
      return (data ?? []).map(taskFromRow);
    },

    async update(userId, id, patch) {
      if (!isUuid(id)) return null;
      const values = columnsOf(patch);
      if (Object.keys(values).length === 0) return get(userId, id);
      const { data, error } = await client
        .from('tasks')
        .update(values)
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
