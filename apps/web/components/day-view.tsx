"use client";

import type { IsoDate, TaskDto, TaskStatus } from "@aj/shared";
import { useTabTitle } from "@/hooks/use-tab-title";
import { useToday } from "@/hooks/use-today";
import { useTasks } from "@/hooks/queries";
import { useStatusChange } from "@/hooks/use-status-change";
import { addDays, formatLongDate } from "@/lib/dates";
import { groupDay, pendingCount } from "@/lib/tasks-view";
import { usePeriodNav } from "./period-nav";
import { TaskRow } from "./task-row";

const OPEN = ["pendente", "em_andamento"] as TaskStatus[];

export function DayView({ date = null }: { date?: IsoDate | null }) {
  const today = useToday();
  if (today === null) return <p role="status">Carregando…</p>;
  return <DayContent today={today} selected={date ?? today} />;
}

/**
 * `today` é o hoje real (atrasadas são sempre relativas a ele); `selected` é o dia exibido
 * (`?d=`), cujas tarefas ocupam as seções "do dia".
 */
function DayContent({ today, selected }: { today: IsoDate; selected: IsoDate }) {
  const overdueQ = useTasks({ status: OPEN, to: addDays(today, -1) });
  const dayQ = useTasks({ status: OPEN, from: selected, to: selected });
  const undatedQ = useTasks({ status: OPEN, withoutDate: true });
  const { error, change } = useStatusChange();

  // Se o dia escolhido é passado, suas tarefas também vêm na consulta de atrasadas: deduplica.
  const byId = new Map<string, TaskDto>();
  for (const t of [...(overdueQ.data ?? []), ...(dayQ.data ?? []), ...(undatedQ.data ?? [])]) byId.set(t.id, t);
  useTabTitle(pendingCount([...byId.values()], today));

  const isToday = selected === today;
  const day = groupDay(dayQ.data ?? [], selected);
  const groups = {
    overdue: groupDay(overdueQ.data ?? [], today).overdue.filter((t) => t.dueDate !== selected),
    undated: groupDay(undatedQ.data ?? [], today).undated,
    fatalToday: day.fatalToday,
    timed: day.timed,
    dateOnly: day.dateOnly,
  };
  const sections: Array<{ title: string; items: TaskDto[] }> = [
    { title: "Atrasadas", items: groups.overdue },
    { title: isToday ? "Fatais de hoje" : "Fatais do dia", items: groups.fatalToday },
    { title: "Com horário", items: groups.timed },
    { title: isToday ? "Demais de hoje" : "Demais do dia", items: groups.dateOnly },
    { title: "Sem data", items: groups.undated },
  ].filter((s) => s.items.length > 0);

  const loading = overdueQ.isPending || dayQ.isPending || undatedQ.isPending;
  const failed = overdueQ.isError || dayQ.isError || undatedQ.isError;

  return (
    <div className="flex flex-col gap-4">
      {!isToday && <SelectedDayBanner date={selected} />}
      {error && (
        <p role="alert" className="rounded border border-[var(--color-fatal)] p-2 text-sm">
          {error}
        </p>
      )}
      {failed && <p role="alert">Não foi possível carregar as tarefas.</p>}
      {loading && !failed && <p role="status">Carregando…</p>}
      {!loading && !failed && sections.length === 0 && <p>{isToday ? "Nada pendente para hoje." : "Nada pendente para este dia."}</p>}
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

function SelectedDayBanner({ date }: { date: IsoDate }) {
  const nav = usePeriodNav();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="font-semibold">{formatLongDate(date)}</p>
      <button
        type="button"
        onClick={nav.goToday}
        className="rounded border border-[var(--color-borda)] px-3 py-1 text-sm"
      >
        Hoje
      </button>
    </div>
  );
}
