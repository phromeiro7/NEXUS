"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { IsoDate, TaskDto, UpdateTaskInput } from "@nexus/shared";
import { useRef, useState } from "react";
import { useToast } from "@/components/mini/toast";
import { ApiError } from "@/lib/api";
import { messageFor } from "@/lib/messages";
import { postponeMessage, restoreInput } from "@/lib/postpone";
import { useUpdateTask } from "./queries";

type Snapshot = Array<[readonly unknown[], TaskDto[] | undefined]>;

/**
 * Adiar com um gesto: troca a data (e a hora, se vier) de forma otimista em todas as listas em cache,
 * com rollback e mensagem se a API recusar, e aviso com "Desfazer" que restaura data e hora de antes.
 */
export function usePostpone() {
  const client = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Set<string>>(new Set());

  const update = useUpdateTask<Snapshot>({
    onMutate: async ({ id, input }) => {
      await client.cancelQueries({ queryKey: ["tasks"] });
      const snapshot = client.getQueriesData<TaskDto[]>({ queryKey: ["tasks"] });
      const patch = {
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.dueTime !== undefined ? { dueTime: input.dueTime } : {}),
      };
      for (const [key, list] of snapshot) {
        if (!list) continue;
        client.setQueryData<TaskDto[]>(key, list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      }
      return snapshot as Snapshot;
    },
    onError: (err, _vars, snapshot) => {
      for (const [key, list] of snapshot ?? []) client.setQueryData(key, list);
      setError(messageFor(err instanceof ApiError ? err : null));
    },
  });

  /** Resolve true quando a API aceitou. */
  async function run(id: string, input: UpdateTaskInput): Promise<boolean> {
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
    const before = restoreInput(task); // antes de mutar: a lista em cache pode ser atualizada no lugar
    const ok = await run(task.id, input);
    if (ok) {
      toast({ message: postponeMessage(task, input, today), undo: () => void run(task.id, before) });
    }
    return ok;
  }

  return { error, postpone, pending: update.isPending };
}
