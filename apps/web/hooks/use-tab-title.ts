"use client";

import { useEffect } from "react";

const BASE = "Assistente Jurídico";

export function useTabTitle(count: number) {
  useEffect(() => {
    const previous = document.title;
    document.title = count > 0 ? `(${count}) ${BASE}` : BASE;
    return () => {
      document.title = previous;
    };
  }, [count]);
}
