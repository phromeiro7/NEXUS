import type { CalculateDeadlineInput, CalculateDeadlineResultDto, Holiday, IsoDate } from '@aj/shared';
import { assertValidDeadlineDays, calculateDeadline } from '../domain/deadline.js';
import { nationalHolidays } from '../domain/holidays.js';
import type { HolidayRepository } from './ports.js';

export type CalculateDeadlineOutput = CalculateDeadlineResultDto;

export function makeCalculateDeadline(deps: { holidays: HolidayRepository }) {
  return async (userId: string, input: CalculateDeadlineInput): Promise<CalculateDeadlineOutput> => {
    // Antes de calcular o intervalo de anos: Infinity aqui travaria o laço abaixo.
    assertValidDeadlineDays(input.days);
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
      feriadosDescontados: result.feriadosDescontados.map((date) => {
        const holiday = byDate.get(date);
        // O domínio só devolve datas do conjunto montado a partir de byDate.
        if (!holiday) throw new Error(`invariante violada: holiday date missing from byDate (${date})`);
        return holiday;
      }),
    };
  };
}
