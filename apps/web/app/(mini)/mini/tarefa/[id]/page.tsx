"use client";

import { useParams } from "next/navigation";
import { TaskDetail } from "@/components/mini/task-detail";

/** /mini/tarefa/[id]: detalhe de uma tarefa. Client component porque lê o id com useParams. */
export default function MiniTaskPage() {
  const { id } = useParams<{ id: string }>();
  return <TaskDetail id={id} />;
}
