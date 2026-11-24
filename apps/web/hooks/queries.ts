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

/**
 * Chaves de cache do React Query. Todas as listas de tarefas começam com "tasks", então invalidar
 * `["tasks"]` atinge qualquer filtro de uma vez.
 */
export const queryKeys = {
  tasks: (query: ListTasksQuery) => ["tasks", query] as const,
  settings: ["settings"] as const,
  briefing: ["briefing"] as const,
};

/** Configurações do usuário (fuso, vínculo do Telegram etc.). */
export function useSettings() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.settings, queryFn: () => api.getSettings() });
}

/** Lista de tarefas para um filtro; cada filtro tem seu próprio cache. */
export function useTasks(query: ListTasksQuery) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.tasks(query), queryFn: () => api.listTasks(query) });
}

/** Uma tarefa pelo id. */
export function useTask(id: string) {
  const api = useApi();
  return useQuery({ queryKey: ["task", id] as const, queryFn: () => api.getTask(id) });
}

/**
 * Recarrega tudo que depende das tarefas: as listas, as tarefas avulsas e o briefing
 * (que resume as tarefas do dia).
 */
export function useInvalidateTasks() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["task"] }),
      queryClient.invalidateQueries({ queryKey: ["briefing"] }),
    ]);
}

/** Cria uma tarefa e recarrega o que depende das tarefas. */
export function useCreateTask() {
  const api = useApi();
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (input: CreateTaskInput) => api.createTask(input),
    onSuccess: invalidate,
  });
}

export type UpdateTaskVars = { id: string; input: UpdateTaskInput };
type UpdateTaskOptions<TContext> = Omit<
  UseMutationOptions<TaskDto, Error, UpdateTaskVars, TContext>,
  "mutationFn"
>;

/**
 * Atualiza uma tarefa e sempre recarrega o que depende das tarefas, com sucesso ou erro.
 * `options` permite acrescentar onMutate/onError (atualização otimista, como em `useStatusChange`
 * e `usePostpone`); o onSettled passado é chamado depois da invalidação.
 */
export function useUpdateTask<TContext = unknown>(options: UpdateTaskOptions<TContext> = {}) {
  const api = useApi();
  const invalidate = useInvalidateTasks();
  return useMutation<TaskDto, Error, UpdateTaskVars, TContext>({
    ...options,
    mutationFn: ({ id, input }) => api.updateTask(id, input),
    onSettled: async (data, error, variables, context, mutationContext) => {
      await invalidate();
      await options.onSettled?.(data, error, variables, context, mutationContext);
    },
  });
}

/** Apaga uma tarefa e recarrega o que depende das tarefas. */
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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) => api.updateSettings(input),
    onSuccess: async (_data, input) => {
      const keysToInvalidate: Array<readonly unknown[]> = [queryKeys.settings];
      if (input.timezone !== undefined) keysToInvalidate.push(["tasks"], queryKeys.briefing);
      await Promise.all(keysToInvalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}

