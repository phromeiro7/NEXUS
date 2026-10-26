import type { CreateHolidayInput, HolidayDto } from '@aj/shared';
import { NotFoundError } from './errors.js';
import type { HolidayAdminRepository } from './ports.js';

export function makeHolidayUseCases(deps: { holidays: HolidayAdminRepository }) {
  return {
    list(userId: string): Promise<HolidayDto[]> {
      return deps.holidays.list(userId);
    },

    create(userId: string, input: CreateHolidayInput): Promise<HolidayDto> {
      return deps.holidays.create(userId, input);
    },

    async remove(userId: string, id: string): Promise<void> {
      if (!(await deps.holidays.remove(userId, id))) throw new NotFoundError('feriado');
    },
  };
}
