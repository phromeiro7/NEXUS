import type { Holiday, IsoDate } from '@aj/shared';

export type HolidayRepository = {
  /** Feriados cadastrados pelo usuário com data entre `from` e `to` (inclusive). */
  listByUser(userId: string, from: IsoDate, to: IsoDate): Promise<Holiday[]>;
};
