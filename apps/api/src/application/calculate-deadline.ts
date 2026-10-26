import type { CalculateDeadlineInput, Holiday, IsoDate } from '@aj/shared';
import { calculateDeadline } from '../domain/deadline.js';
import { nationalHolidays } from '../domain/holidays.js';
import type { HolidayRepository } from './ports.js';

export type CalculateDeadlineOutput = {
  dueDate: IsoDate;
  prorrogado: boolean;
  feriadosDescontados: Holiday[];
};

export function makeCalculateDeadline(deps: { holidays: HolidayRepository }) {
  return async (userId: string, input: CalculateDeadlineInput): Promise<CalculateDeadlineOutput> => {
    const firstYear = Number(input.baseDate.slice(0, 4));
    const lastYear = firstYear + Math.ceil(input.days / 200) + 1;

    // Feriados nacionais primeiro: em data repetida, vale o nome do nacional.
    const byDate = new Map<IsoDate, Holiday>();
    for (let year = firstYear; year <= lastYear; year += 1) {
      for (const h of nationalHolidays(year)) byDate.set(h.date, h);
    }
    const from = input.baseDate;
    const to = `${lastYear}-12-31` as IsoDate;
    for (const h of await deps.holidays.listByUser(userId, from, to)) {
      if (h.date >= from && h.date <= to && !byDate.has(h.date)) byDate.set(h.date, h);
    }

    const result = calculateDeadline({ ...input, holidays: new Set(byDate.keys()) });
    return {
      dueDate: result.dueDate,
      prorrogado: result.prorrogado,
      feriadosDescontados: result.feriadosDescontados.map(
        (date) => byDate.get(date) ?? { date, name: 'Feriado' },
      ),
    };
  };
}
