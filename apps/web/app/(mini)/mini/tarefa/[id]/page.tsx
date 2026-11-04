"use client";

import { useParams } from "next/navigation";
import { TaskDetail } from "@/components/mini/task-detail";

export default function MiniTaskPage() {
  const { id } = useParams<{ id: string }>();
  return <TaskDetail id={id} />;
}
