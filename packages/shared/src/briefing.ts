import type { IsoDate } from './primitives.js';
import type { TaskDto } from './task-api.js';

export type BriefingDto = {
  today: IsoDate;
  overdue: TaskDto[];
  fatalToday: TaskDto[];
  hearingsToday: TaskDto[];
  nextTwoDays: TaskDto[];
};
