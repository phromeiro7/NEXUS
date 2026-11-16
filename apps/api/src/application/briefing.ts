import { todayIn, type BriefingDto } from '@nexus/shared';
import { buildBriefing } from '../domain/briefing.js';
import type { Clock, ProfileRepository, TaskRepository } from './ports.js';

export function makeGetBriefing(deps: { tasks: TaskRepository; profiles: ProfileRepository; clock: Clock }) {
  return async (userId: string): Promise<BriefingDto> => {
    const profile = await deps.profiles.get(userId);
    const today = todayIn(profile.timezone, deps.clock.now());
    const tasks = await deps.tasks.list(userId, { status: ['pendente', 'em_andamento'] });
    return { today, ...buildBriefing(tasks, today) };
  };
}
