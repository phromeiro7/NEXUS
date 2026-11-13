"use client";

import { useParams } from "next/navigation";
import { EntryEdit } from "@/components/mini/entry-form";

export default function MiniEditEntryPage() {
  const { id } = useParams<{ id: string }>();
  return <EntryEdit id={id} />;
}
