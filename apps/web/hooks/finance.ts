"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FinanceEntryDto, FinanceStatus } from "@aj/shared";
import { useApi, useAuth } from "@/components/auth-provider";
import { ApiError } from "@/lib/api";
import type { Lancamento, LancamentoInput, LancamentoPatch } from "@/lib/finance";
import { byCreation, toCreateInput, toLancamento, toUpdateInput } from "@/lib/finance-map";
import { clearLocalLancamentos, readLocalLancamentos } from "@/lib/finance-local";

/** Todos os lançamentos do usuário numa consulta só: as telas filtram por mês, dia e tipo. */
const KEY = ["finance"] as const;
const MUTATION_KEY = ["finance", "mutation"] as const;
/** Falha ao salvar, compartilhada por todas as telas montadas (cada useFinance() é uma instância). */
const SAVE_ERROR_KEY = ["finance-save-error"] as const;
const EMPTY: readonly Lancamento[] = [];

export type FinanceApi = {
  lancamentos: readonly Lancamento[];
  /** Primeira carga ainda em andamento: a lista vazia ainda não é "nada anotado". */
  loading: boolean;
  /** "load": não foi possível carregar · "save": a última alteração não foi salva e foi desfeita na tela. */
  error: "load" | "save" | null;
  reload(): void;
  dismissError(): void;
  add(input: LancamentoInput): Lancamento | null;
  restore(item: Lancamento): void;
  marcarPaga(id: string): void;
  desmarcarPaga(id: string): void;
  remove(id: string): void;
  /** Muda descrição, valor, categoria, data ou lembrete; o tipo e a situação ficam como estão. */
  edit(id: string, patch: LancamentoPatch): void;
};

function newId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 409 em criar (já existe) e 404 em apagar (já não existe) significam que o estado desejado já vale. */
function alreadyDone(e: unknown, ...codes: number[]): boolean {
  return e instanceof ApiError && codes.includes(e.status);
}

/**
 * Único ponto de acesso das telas aos dados financeiros. Os dados vivem na API; a tela reage na
 * hora (atualização otimista) e, se a API recusar, volta ao que o servidor tem e avisa.
 */
export function useFinance(): FinanceApi {
  const api = useApi();
  const { userId } = useAuth();
  const qc = useQueryClient();
  const { data: saveFailed } = useQuery({
    queryKey: SAVE_ERROR_KEY,
    queryFn: () => false,
    enabled: false,
    initialData: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const setSaveFailed = useCallback((v: boolean) => qc.setQueryData(SAVE_ERROR_KEY, v), [qc]);

  const query = useQuery({
    queryKey: KEY,
    queryFn: () => api.listFinanceEntries(),
    enabled: userId !== null,
  });

  const patchCache = useCallback(
    (fn: (list: FinanceEntryDto[]) => FinanceEntryDto[]) => {
      qc.setQueryData<FinanceEntryDto[]>(KEY, (old) => fn(old ?? []));
    },
    [qc],
  );

  /** Só a última mutação em andamento recarrega, para não apagar a atualização otimista das outras. */
  const settle = useCallback(async () => {
    if (qc.isMutating({ mutationKey: MUTATION_KEY }) <= 1) await qc.invalidateQueries({ queryKey: KEY });
  }, [qc]);

  const fail = useCallback(() => setSaveFailed(true), [setSaveFailed]);

  const create = useMutation({
    mutationKey: MUTATION_KEY,
    mutationFn: async (item: Lancamento) => {
      try {
        await api.createFinanceEntry(toCreateInput(item));
      } catch (e) {
        if (!alreadyDone(e, 409)) throw e;
      }
    },
    onMutate: async (item) => {
      await qc.cancelQueries({ queryKey: KEY });
      patchCache((list) =>
        list.some((e) => e.id === item.id)
          ? list
          : [
              ...list,
              {
                id: item.id,
                kind: item.tipo,
                description: item.descricao,
                amountCents: item.valorCentavos,
                category: item.categoria,
                dueDate: item.data,
                status: item.situacao,
                reminderTime: item.lembreteHora,
                paidAt: item.situacao === "paga" ? item.criadoEm : null,
                createdAt: item.criadoEm,
                updatedAt: item.criadoEm,
              },
            ],
      );
    },
    onError: fail,
    onSettled: settle,
  });

  const setStatus = useMutation({
    mutationKey: MUTATION_KEY,
    mutationFn: ({ id, status }: { id: string; status: FinanceStatus }) =>
      api.updateFinanceEntry(id, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const now = new Date().toISOString();
      patchCache((list) =>
        list.map((e) => (e.id === id ? { ...e, status, paidAt: status === "paga" ? (e.paidAt ?? now) : null } : e)),
      );
    },
    onError: fail,
    onSettled: settle,
  });

  const destroy = useMutation({
    mutationKey: MUTATION_KEY,
    mutationFn: async (id: string) => {
      try {
        await api.deleteFinanceEntry(id);
      } catch (e) {
        if (!alreadyDone(e, 404)) throw e;
      }
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEY });
      patchCache((list) => list.filter((e) => e.id !== id));
    },
    onError: fail,
    onSettled: settle,
  });

  const update = useMutation({
    mutationKey: MUTATION_KEY,
    mutationFn: ({ id, patch }: { id: string; patch: LancamentoPatch }) => api.updateFinanceEntry(id, toUpdateInput(patch)),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: KEY });
      patchCache((list) =>
        list.map((e) =>
          e.id === id
            ? {
                ...e,
                ...(patch.descricao !== undefined ? { description: patch.descricao } : {}),
                ...(patch.valorCentavos !== undefined ? { amountCents: patch.valorCentavos } : {}),
                ...(patch.categoria !== undefined ? { category: patch.categoria } : {}),
                ...(patch.data !== undefined ? { dueDate: patch.data } : {}),
                ...(patch.lembreteHora !== undefined ? { reminderTime: patch.lembreteHora } : {}),
              }
            : e,
        ),
      );
    },
    onError: fail,
    onSettled: settle,
  });

  const data = query.data;
  const lancamentos = useMemo(() => (data ? data.map(toLancamento).sort(byCreation) : EMPTY), [data]);

  const add = useCallback(
    (input: LancamentoInput): Lancamento | null => {
      if (userId === null) return null;
      const item: Lancamento = { ...input, id: newId(), criadoEm: new Date().toISOString() };
      setSaveFailed(false);
      create.mutate(item);
      return item;
    },
    [userId, create, setSaveFailed],
  );
  const restore = useCallback(
    (item: Lancamento) => {
      setSaveFailed(false);
      create.mutate(item);
    },
    [create, setSaveFailed],
  );
  const marcarPaga = useCallback(
    (id: string) => {
      setSaveFailed(false);
      setStatus.mutate({ id, status: "paga" });
    },
    [setStatus, setSaveFailed],
  );
  const desmarcarPaga = useCallback(
    (id: string) => {
      setSaveFailed(false);
      setStatus.mutate({ id, status: "a_pagar" });
    },
    [setStatus, setSaveFailed],
  );
  const remove = useCallback(
    (id: string) => {
      setSaveFailed(false);
      destroy.mutate(id);
    },
    [destroy, setSaveFailed],
  );
  const edit = useCallback(
    (id: string, patch: LancamentoPatch) => {
      if (Object.keys(patch).length === 0) return;
      setSaveFailed(false);
      update.mutate({ id, patch });
    },
    [update, setSaveFailed],
  );
  const reload = useCallback(() => void query.refetch(), [query]);
  const dismissError = useCallback(() => setSaveFailed(false), [setSaveFailed]);

  const error: FinanceApi["error"] = saveFailed ? "save" : query.isError && !data ? "load" : null;

  return useMemo(
    () => ({
      lancamentos,
      loading: query.isPending && !query.isError,
      error,
      reload,
      dismissError,
      add,
      restore,
      marcarPaga,
      desmarcarPaga,
      remove,
      edit,
    }),
    [lancamentos, query.isPending, query.isError, error, reload, dismissError, add, restore, marcarPaga, desmarcarPaga, remove, edit],
  );
}

export type LocalImport = {
  /** Quantos lançamentos antigos ainda estão só neste aparelho. */
  count: number;
  importing: boolean;
  failed: boolean;
  importar(): Promise<void>;
  descartar(): void;
};

/**
 * Importação única dos lançamentos que a versão anterior guardava no navegador. Cada um vai com o
 * próprio id: repetir a importação (por queda de rede, por exemplo) não duplica nada.
 */
export function useLocalImport(): LocalImport {
  const api = useApi();
  const { userId } = useAuth();
  const qc = useQueryClient();
  const [items, setItems] = useState<Lancamento[]>([]);
  const [importing, setImporting] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setItems(userId === null ? [] : readLocalLancamentos(userId));
  }, [userId]);

  const importar = useCallback(async () => {
    if (userId === null || importing) return;
    setImporting(true);
    setFailed(false);
    try {
      for (const item of items) {
        try {
          await api.createFinanceEntry(toCreateInput(item));
        } catch (e) {
          if (!alreadyDone(e, 409)) throw e;
        }
      }
      clearLocalLancamentos(userId);
      setItems([]);
    } catch {
      setFailed(true);
    } finally {
      setImporting(false);
      await qc.invalidateQueries({ queryKey: KEY });
    }
  }, [api, userId, items, importing, qc]);

  const descartar = useCallback(() => {
    if (userId === null) return;
    clearLocalLancamentos(userId);
    setItems([]);
    setFailed(false);
  }, [userId]);

  return { count: items.length, importing, failed, importar, descartar };
}
