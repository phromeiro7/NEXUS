"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";
import type {
  CreateTaskInput,
  ListTasksQuery,
  TaskDto,
  UpdateSettingsInput,
  UpdateTaskInput,
} from "@nexus/shared";
import { useApi } from "@/components/auth-provider";

export const queryKeys = {
  tasks: (query: ListTasksQuery) => ["tasks", query] as const,
  settings: ["settings"] as const,
  briefing: ["briefing"] as const,
};

export function useSettings() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.settings, queryFn: () => api.getSettings() });
}

export function useTasks(query: ListTasksQuery) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.tasks(query), queryFn: () => api.listTasks(query) });
}

export function useTask(id: string) {
  const api = useApi();
  return useQuery({ queryKey: ["task", id] as const, queryFn: () => api.getTask(id) });
}

export function useInvalidateTasks() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["tasks"] }),
      client.invalidateQueries({ queryKey: ["task"] }),
      client.invalidateQueries({ queryKey: ["briefing"] }),
    ]);
}

export function useCreateTask() {
  const api = useApi();
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (input: CreateTaskInput) => api.createTask(input),
    onSuccess: invalidate,
  });
}

export type UpdateTaskVars = { id: string; input: UpdateTaskInput };
type UpdateOptions<TContext> = Omit<
  UseMutationOptions<TaskDto, Error, UpdateTaskVars, TContext>,
  "mutationFn"
>;

/**
 * `options` permite à Tarefa 7 acrescentar onMutate/onError (atualização otimista);
 * o onSettled passado é chamado depois da invalidação.
 */
export function useUpdateTask<TContext = unknown>(options: UpdateOptions<TContext> = {}) {
  const api = useApi();
  const invalidate = useInvalidateTasks();
  return useMutation<TaskDto, Error, UpdateTaskVars, TContext>({
    ...options,
    mutationFn: ({ id, input }) => api.updateTask(id, input),
    onSettled: async (data, error, vars, ctx, meta) => {
      await invalidate();
      await options.onSettled?.(data, error, vars, ctx, meta);
    },
  });
}

export function useDeleteTask() {
  const api = useApi();
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (id: string) => api.deleteTask(id),
    onSuccess: invalidate,
  });
}

/** Trocar o fuso muda o "hoje" e a hora das tarefas: tarefas e briefing também são invalidados. */
export function useUpdateSettings() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) => api.updateSettings(input),
    onSuccess: async (_data, input) => {
      const keys: Array<readonly unknown[]> = [queryKeys.settings];
      if (input.timezone !== undefined) keys.push(["tasks"], queryKeys.briefing);
      await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
    },
  });
}

