"use client";

import { useCallback, useRef, useState } from "react";
import { assistantMessageInputSchema, type AssistantReplyDto } from "@aj/shared";
import { useApi } from "@/components/auth-provider";
import { ApiError } from "@/lib/api";
import { useInvalidateTasks } from "./queries";

/**
 * Envia mensagens ao assistente. O `clientMessageId` é gerado por texto distinto e mantido
 * entre tentativas que falham (o servidor reaproveita o evento); troca após sucesso ou ao mudar o texto.
 */
export function useAssistant() {
  const api = useApi();
  const invalidate = useInvalidateTasks();
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;
  const [pending, setPending] = useState(false);
  const inflight = useRef<Promise<AssistantReplyDto> | null>(null);
  const attempt = useRef<{ text: string; id: string } | null>(null);

  const send = useCallback(
    (text: string): Promise<AssistantReplyDto> => {
      if (inflight.current !== null) return inflight.current;
      const trimmed = text.trim();
      if (attempt.current === null || attempt.current.text !== trimmed) {
        attempt.current = { text: trimmed, id: crypto.randomUUID() };
      }
      const parsed = assistantMessageInputSchema.safeParse({
        text: trimmed,
        clientMessageId: attempt.current.id,
      });
      if (!parsed.success) {
        return Promise.reject(new ApiError(400, "entrada_invalida", null));
      }
      setPending(true);
      const run = (async () => {
        try {
          const reply = await api.sendAssistantMessage(parsed.data);
          attempt.current = null;
          // Não espera o recarregamento: a resposta já foi gravada no servidor.
          void invalidateRef.current().catch(() => undefined);
          return reply;
        } finally {
          inflight.current = null;
          setPending(false);
        }
      })();
      inflight.current = run;
      return run;
    },
    [api],
  );

  return { send, pending };
}
