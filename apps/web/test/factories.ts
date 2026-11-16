import type { TaskDto } from "@nexus/shared";

export function makeTask(over: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "t1",
    title: "Tarefa",
    type: "tarefa",
    status: "pendente",
    dueDate: "2026-10-27",
    dueTime: null,
    fatal: false,
    completedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}
