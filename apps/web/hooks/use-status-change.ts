"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { TaskDto, TaskStatus } from "@nexus/shared";
import { useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { messageFor } from "@/lib/messages";
import { useUpdateTask } from "./queries";

type Snapshot = Array<[readonly unknown[], TaskDto[] | undefined]>;

/**
 * Troca de status otimista (todas as listas de tarefas em cache), com rollback e mensagem
 * em caso de erro, e trava por tarefa contra duplo clique.
 */
export function useStatusChange() {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Set<string>>(new Set());

  const update = useUpdateTask<Snapshot>({
    onMutate: async ({ id, input }) => {
      await client.cancelQueries({ queryKey: ["tasks"] });
      const snapshot = client.getQueriesData<TaskDto[]>({ queryKey: ["tasks"] });
      for (const [key, list] of snapshot) {
        if (!list) continue;
        client.setQueryData<TaskDto[]>(
          key,
          list.map((t) => (t.id === id && input.status ? { ...t, status: input.status } : t)),
        );
      }
      return snapshot as Snapshot;
    },
    onError: (err, _vars, snapshot) => {
      for (const [key, list] of snapshot ?? []) client.setQueryData(key, list);
      setError(messageFor(err instanceof ApiError ? err : null));
    },
  });

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
