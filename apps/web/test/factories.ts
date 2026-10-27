import type { TaskDto } from "@aj/shared";

export function makeTask(over: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "t1",
    caseId: null,
    title: "Tarefa",
    type: "tarefa",
    status: "pendente",
    dueDate: "2026-10-27",
    dueTime: null,
    fatal: false,
    baseDate: null,
    periodDays: null,
    countType: null,
    completedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}
