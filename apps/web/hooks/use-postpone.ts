"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { IsoDate, TaskDto, UpdateTaskInput } from "@nexus/shared";
import { useRef, useState } from "react";
import { useToast } from "@/components/mini/toast";
import { ApiError } from "@/lib/api";
import { messageFor } from "@/lib/messages";
import { postponeMessage, restoreInput } from "@/lib/postpone";
import { useUpdateTask } from "./queries";

/** Cópia de todas as listas de tarefas em cache antes da mudança, para o rollback. */
type TaskListsSnapshot = Array<[readonly unknown[], TaskDto[] | undefined]>;

/**
 * Adiar com um gesto: troca a data (e a hora, se vier) de forma otimista em todas as listas em cache,
 * com rollback e mensagem se a API recusar, e aviso com "Desfazer" que restaura data e hora de antes.
 */
export function usePostpone() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  // Ids com adiamento em andamento: trava contra duplo clique na mesma tarefa.
  const inFlight = useRef<Set<string>>(new Set());

  const update = useUpdateTask<TaskListsSnapshot>({
    onMutate: async ({ id, input }) => {
      // Cancela buscas em andamento para não sobrescreverem a atualização otimista; `["tasks"]` cobre todos os filtros.
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      const snapshot = queryClient.getQueriesData<TaskDto[]>({ queryKey: ["tasks"] });
      // Só os campos enviados mudam: sem `dueTime` no pedido, a hora em cache fica como está.
      const patch = {
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.dueTime !== undefined ? { dueTime: input.dueTime } : {}),
      };
      for (const [queryKey, tasks] of snapshot) {
        if (!tasks) continue;
        queryClient.setQueryData<TaskDto[]>(queryKey, tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)));
      }
      return snapshot as TaskListsSnapshot;
    },
    onError: (error, _variables, snapshot) => {
      // Rollback: devolve cada lista ao estado de antes da atualização otimista.
      for (const [queryKey, tasks] of snapshot ?? []) queryClient.setQueryData(queryKey, tasks);
      setError(messageFor(error instanceof ApiError ? error : null));
    },
  });

  /** Resolve true quando a API aceitou. */
  async function submitUpdate(id: string, input: UpdateTaskInput): Promise<boolean> {
    if (inFlight.current.has(id)) return false;
    inFlight.current.add(id);
    setError(null);
    try {
      await update.mutateAsync({ id, input });
      return true;
    } catch {
      return false; // já tratado em onError
    } finally {
      inFlight.current.delete(id);
    }
  }

  async function postpone(task: TaskDto, input: UpdateTaskInput & { dueDate: IsoDate }, today: IsoDate): Promise<boolean> {
    const previousSchedule = restoreInput(task); // antes de mutar: a lista em cache pode ser atualizada no lugar
    const accepted = await submitUpdate(task.id, input);
    if (accepted) {
      toast({ message: postponeMessage(task, input, today), undo: () => void submitUpdate(task.id, previousSchedule) });
    }
    return accepted;
  }

  return { error, postpone, pending: update.isPending };
}
