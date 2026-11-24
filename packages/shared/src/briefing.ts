import type { IsoDate } from './primitives.js';
import type { TaskDto } from './task-api.js';

/** Listas do briefing diário, já calculadas para o dia local `today`. */
export type BriefingDto = {
  today: IsoDate;
  overdue: TaskDto[];
  fatalToday: TaskDto[];
  hearingsToday: TaskDto[];
  nextTwoDays: TaskDto[];
};
