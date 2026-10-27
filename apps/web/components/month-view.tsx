"use client";

import type { IsoDate, TaskStatus } from "@aj/shared";
import { useToday } from "@/hooks/use-today";
import { useTasks } from "@/hooks/queries";
import { addDays, formatLongDate, monthGrid, monthRange } from "@/lib/dates";
import { countByDay } from "@/lib/tasks-view";
import { PeriodNav, usePeriodNav } from "./period-nav";

const OPEN = ["pendente", "em_andamento"] as TaskStatus[];
const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function countLabel(c: { total: number; fatal: number } | undefined): string {
  if (!c || c.total === 0) return "";
  const total = `${c.total} ${c.total === 1 ? "tarefa" : "tarefas"}`;
  return c.fatal > 0 ? `${total}, ${c.fatal} ${c.fatal === 1 ? "fatal" : "fatais"}` : total;
}

/** Sem year/month, mostra o mês de hoje (no fuso das configurações). month é 1-12. */
export function MonthView({ year, month }: { year?: number; month?: number }) {
  const today = useToday();
  if (today === null) return <p role="status">Carregando…</p>;
  const y = year ?? Number(today.slice(0, 4));
  const m = month ?? Number(today.slice(5, 7));
  return <MonthContent today={today} year={y} month={m} />;
}

function MonthContent({ today, year, month }: { today: IsoDate; year: number; month: number }) {
  const { from, to } = monthRange(year, month);
  // Só o mês: dias de preenchimento (meses vizinhos) aparecem esmaecidos e sem contagem.
  const tasksQ = useTasks({ from, to, status: OPEN });
  const nav = usePeriodNav();
  const counts = countByDay(tasksQ.data ?? []);
  const grid = monthGrid(year, month);

  return (
    <div>
      <PeriodNav
        label={`${MONTHS[month - 1]} de ${year}`}
        prevLabel="Mês anterior"
        nextLabel="Mês seguinte"
        onPrev={() => nav.goTo(`${addDays(from, -1).slice(0, 8)}01`)}
        onNext={() => nav.goTo(addDays(to, 1))}
        onToday={nav.goToday}
      />
      {tasksQ.isError && <p role="alert">Não foi possível carregar as tarefas.</p>}
      {tasksQ.isPending && <p role="status">Carregando…</p>}
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th key={d} scope="col" className="p-1 text-xs font-semibold">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row) => (
            <tr key={row[0]}>
              {row.map((date) => {
                const outside = date < from || date > to;
                const isToday = date === today;
                const label = countLabel(counts[date]);
                return (
                  <td key={date} className="border border-[var(--color-borda)] p-0 align-top">
                    <button
                      type="button"
                      data-outside={outside ? "true" : undefined}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={`${formatLongDate(date)}${label ? `, ${label}` : ""}`}
                      onClick={() => nav.openDay(date)}
                      className={`flex min-h-16 w-full flex-col items-start gap-0.5 p-1 text-left text-xs ${
                        outside ? "opacity-50" : ""
                      } ${isToday ? "outline outline-2 -outline-offset-2 outline-[var(--color-destaque)]" : ""}`}
                    >
                      <span className="font-semibold">
                        {Number(date.slice(8, 10))}
                        {isToday && <span className="ml-1 font-normal">(hoje)</span>}
                      </span>
                      {label && <span className="break-words">{label}</span>}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
