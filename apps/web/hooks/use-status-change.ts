"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { TaskDto, TaskStatus } from "@nexus/shared";
import { useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { messageFor } from "@/lib/messages";
import { useUpdateTask } from "./queries";

/** Cópia de todas as listas de tarefas em cache antes da mudança, para o rollback. */
type TaskListsSnapshot = Array<[readonly unknown[], TaskDto[] | undefined]>;

/**
 * Troca de status otimista (todas as listas de tarefas em cache), com rollback e mensagem
 * em caso de erro, e trava por tarefa contra duplo clique.
 */
export function useStatusChange() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Set<string>>(new Set());

  const update = useUpdateTask<TaskListsSnapshot>({
    onMutate: async ({ id, input }) => {
      // Cancela buscas em andamento para não sobrescreverem a atualização otimista; `["tasks"]` cobre todos os filtros.
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      const snapshot = queryClient.getQueriesData<TaskDto[]>({ queryKey: ["tasks"] });
      for (const [queryKey, tasks] of snapshot) {
        if (!tasks) continue;
        queryClient.setQueryData<TaskDto[]>(
          queryKey,
          tasks.map((task) => (task.id === id && input.status ? { ...task, status: input.status } : task)),
        );
      }
      return snapshot as TaskListsSnapshot;
    },
    onError: (error, _variables, snapshot) => {
      // Rollback: devolve cada lista ao estado de antes da atualização otimista.
      for (const [queryKey, tasks] of snapshot ?? []) queryClient.setQueryData(queryKey, tasks);
      setError(messageFor(error instanceof ApiError ? error : null));
    },
  });

  /** Troca o status; ignora o clique se a mesma tarefa ainda está sendo atualizada. */
  async function change(id: string, status: TaskStatus) {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setError(null);
    try {
      await update.mutateAsync({ id, input: { status } });
    } catch {
      // já tratado em onError
    } finally {
      inFlight.current.delete(id);
    }
  }

  return { error, change };
}
