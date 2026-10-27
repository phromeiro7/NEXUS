"use client";

import type { IsoDate, TaskStatus } from "@aj/shared";
import { useToday } from "@/hooks/use-today";
import { useTasks } from "@/hooks/queries";
import { useStatusChange } from "@/hooks/use-status-change";
import { addDays, formatShort, weekRange } from "@/lib/dates";
import { groupWeek } from "@/lib/tasks-view";
import { PeriodNav, usePeriodNav } from "./period-nav";
import { TaskRowActions } from "./task-actions";
import { TaskRow } from "./task-row";

const OPEN = ["pendente", "em_andamento"] as TaskStatus[];
const WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

/** `anchor` é qualquer dia da semana; null = semana de hoje (no fuso das configurações). */
export function WeekView({ anchor }: { anchor: IsoDate | null }) {
  const today = useToday();
  if (today === null) return <p role="status">Carregando…</p>;
  return <WeekContent today={today} anchor={anchor ?? today} />;
}

function WeekContent({ today, anchor }: { today: IsoDate; anchor: IsoDate }) {
  const { from, to } = weekRange(anchor);
  const tasksQ = useTasks({ from, to, status: OPEN });
  const { error, change } = useStatusChange();
  const nav = usePeriodNav();

  const days = groupWeek(tasksQ.data ?? [], from);

  return (
    <div>
      <PeriodNav
        label={`${formatShort(from)} a ${formatShort(to)}`}
        prevLabel="Semana anterior"
        nextLabel="Semana seguinte"
        onPrev={() => nav.goTo(addDays(from, -7))}
        onNext={() => nav.goTo(addDays(from, 7))}
        onToday={nav.goToday}
      />
      {error && (
        <p role="alert" className="mb-3 rounded border border-[var(--color-fatal)] p-2 text-sm">
          {error}
        </p>
      )}
      {tasksQ.isError && <p role="alert">Não foi possível carregar as tarefas.</p>}
      {tasksQ.isPending && <p role="status">Carregando…</p>}
      {!tasksQ.isPending && !tasksQ.isError && (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-7">
          {days.map((day, i) => {
            const isToday = day.date === today;
            const name = `${WEEKDAYS[i]} ${formatShort(day.date)}`;
            return (
              <section
                key={day.date}
                aria-label={name}
                aria-current={isToday ? "date" : undefined}
                className={`min-w-0 rounded border p-2 ${
                  isToday ? "border-2 border-[var(--color-destaque)]" : "border-[var(--color-borda)]"
                }`}
              >
                <h3 className="mb-2 text-sm font-semibold">
                  {WEEKDAYS[i]} {formatShort(day.date)}
                  {isToday && <span className="ml-1 font-normal">(hoje)</span>}
                </h3>
                {day.tasks.length === 0 ? (
                  <p className="text-sm opacity-80">Sem tarefas</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {day.tasks.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        today={today}
                        onChange={(s) => void change(t.id, s)}
                        actions={<TaskRowActions task={t} />}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
