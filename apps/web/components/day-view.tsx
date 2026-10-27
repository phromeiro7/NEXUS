"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { IsoDate, TaskDto, TaskStatus } from "@aj/shared";
import { useRef, useState } from "react";
import { useTabTitle } from "@/hooks/use-tab-title";
import { useToday } from "@/hooks/use-today";
import { useTasks, useUpdateTask } from "@/hooks/queries";
import { ApiError } from "@/lib/api";
import { addDays } from "@/lib/dates";
import { messageFor } from "@/lib/messages";
import { groupDay, pendingCount } from "@/lib/tasks-view";
import { TaskRow } from "./task-row";

const OPEN = ["pendente", "em_andamento"] as TaskStatus[];

type Snapshot = Array<[readonly unknown[], TaskDto[] | undefined]>;

export function DayView() {
  const today = useToday();
  if (today === null) return <p role="status">Carregando…</p>;
  return <DayContent today={today} />;
}

function DayContent({ today }: { today: IsoDate }) {
  const client = useQueryClient();
  const overdueQ = useTasks({ status: OPEN, to: addDays(today, -1) });
  const todayQ = useTasks({ status: OPEN, from: today, to: today });
  const undatedQ = useTasks({ status: OPEN, withoutDate: true });
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Set<string>>(new Set());

  const tasks = [...(overdueQ.data ?? []), ...(todayQ.data ?? []), ...(undatedQ.data ?? [])];
  useTabTitle(pendingCount(tasks, today));

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

  const groups = groupDay(tasks, today);
  const sections: Array<{ title: string; items: TaskDto[] }> = [
    { title: "Atrasadas", items: groups.overdue },
    { title: "Fatais de hoje", items: groups.fatalToday },
    { title: "Com horário", items: groups.timed },
    { title: "Demais de hoje", items: groups.dateOnly },
    { title: "Sem data", items: groups.undated },
  ].filter((s) => s.items.length > 0);

  const loading = overdueQ.isPending || todayQ.isPending || undatedQ.isPending;
  const failed = overdueQ.isError || todayQ.isError || undatedQ.isError;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded border border-[var(--color-fatal)] p-2 text-sm">
          {error}
        </p>
      )}
      {failed && <p role="alert">Não foi possível carregar as tarefas.</p>}
      {loading && !failed && <p role="status">Carregando…</p>}
      {!loading && !failed && sections.length === 0 && <p>Nada pendente para hoje.</p>}
      {sections.map((s) => (
        <section key={s.title} aria-label={s.title}>
          <h2 className="mb-2 text-lg font-semibold">{s.title}</h2>
          <ul className="flex flex-col gap-2">
            {s.items.map((t) => (
              <TaskRow key={t.id} task={t} today={today} onChange={(status) => void change(t.id, status)} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
