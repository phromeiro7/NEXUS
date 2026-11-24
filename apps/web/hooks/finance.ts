"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FinanceEntryDto, FinanceStatus } from "@nexus/shared";
import { useApi, useAuth } from "@/components/auth-provider";
import { ApiError } from "@/lib/api";
import type { Lancamento, LancamentoInput } from "@/lib/finance";
import { byCreation, toCreateInput, toLancamento } from "@/lib/finance-map";
import { clearLocalLancamentos, readLocalLancamentos } from "@/lib/finance-local";

/** Todos os lançamentos do usuário numa consulta só: as telas filtram por mês, dia e tipo. */
const FINANCE_QUERY_KEY = ["finance"] as const;
/** Marca as mutações financeiras para contar quantas ainda estão em andamento (ver `settle`). */
const FINANCE_MUTATION_KEY = ["finance", "mutation"] as const;
/** Falha ao salvar, compartilhada por todas as telas montadas (cada useFinance() é uma instância). */
const SAVE_ERROR_KEY = ["finance-save-error"] as const;
/** Referência estável para a lista vazia: evita recalcular memos enquanto não há dados. */
const NO_ENTRIES: readonly Lancamento[] = [];

const HTTP_CONFLICT = 409;
const HTTP_NOT_FOUND = 404;

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
};

/**
 * UUID v4 gerado no cliente. `randomUUID` só existe em contexto seguro (HTTPS/localhost); fora dele,
 * monta o mesmo formato a partir de bytes aleatórios.
 */
function generateId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  // Bits fixos do RFC 4122: versão 4 no byte 6 e variante "10xx" no byte 8.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 409 em criar (já existe) e 404 em apagar (já não existe) significam que o estado desejado já vale. */
function alreadyDone(error: unknown, ...statusCodes: number[]): boolean {
  return error instanceof ApiError && statusCodes.includes(error.status);
}

/**
 * Único ponto de acesso das telas aos dados financeiros. Os dados vivem na API; a tela reage na
 * hora (atualização otimista) e, se a API recusar, volta ao que o servidor tem e avisa.
 */
export function useFinance(): FinanceApi {
  const api = useApi();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  // Estado local guardado no cache (sem buscar nada) só para ser compartilhado entre as instâncias.
  const { data: saveFailed } = useQuery({
    queryKey: SAVE_ERROR_KEY,
    queryFn: () => false,
    enabled: false,
    initialData: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const setSaveFailed = useCallback((failed: boolean) => queryClient.setQueryData(SAVE_ERROR_KEY, failed), [queryClient]);

  const query = useQuery({
    queryKey: FINANCE_QUERY_KEY,
    queryFn: () => api.listFinanceEntries(),
    enabled: userId !== null,
  });

  /** Atualização otimista: aplica a mudança direto na lista em cache, antes da resposta da API. */
  const patchCache = useCallback(
    (update: (entries: FinanceEntryDto[]) => FinanceEntryDto[]) => {
      queryClient.setQueryData<FinanceEntryDto[]>(FINANCE_QUERY_KEY, (cached) => update(cached ?? []));
    },
    [queryClient],
  );

  /** Só a última mutação em andamento recarrega, para não apagar a atualização otimista das outras. */
  const settle = useCallback(async () => {
    const isLastPendingMutation = queryClient.isMutating({ mutationKey: FINANCE_MUTATION_KEY }) <= 1;
    if (isLastPendingMutation) await queryClient.invalidateQueries({ queryKey: FINANCE_QUERY_KEY });
  }, [queryClient]);

  const markSaveFailed = useCallback(() => setSaveFailed(true), [setSaveFailed]);

  const create = useMutation({
    mutationKey: FINANCE_MUTATION_KEY,
    mutationFn: async (item: Lancamento) => {
      try {
        await api.createFinanceEntry(toCreateInput(item));
      } catch (error) {
        if (!alreadyDone(error, HTTP_CONFLICT)) throw error;
      }
    },
    onMutate: async (item) => {
      // Cancela buscas em andamento: a resposta antiga sobrescreveria a atualização otimista.
      await queryClient.cancelQueries({ queryKey: FINANCE_QUERY_KEY });
      // Mesmo id já na lista (ex.: "desfazer" repetido): não duplica.
      patchCache((entries) =>
        entries.some((entry) => entry.id === item.id)
          ? entries
          : [
              ...entries,
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
    onError: markSaveFailed,
    onSettled: settle,
  });

  const setStatus = useMutation({
    mutationKey: FINANCE_MUTATION_KEY,
    mutationFn: ({ id, status }: { id: string; status: FinanceStatus }) =>
      api.updateFinanceEntry(id, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: FINANCE_QUERY_KEY });
      const now = new Date().toISOString();
      // Marcar como paga mantém a data de pagamento que já existia; desmarcar a apaga.
      patchCache((entries) =>
        entries.map((entry) =>
          entry.id === id ? { ...entry, status, paidAt: status === "paga" ? (entry.paidAt ?? now) : null } : entry,
        ),
      );
    },
    onError: markSaveFailed,
    onSettled: settle,
  });

  const destroy = useMutation({
    mutationKey: FINANCE_MUTATION_KEY,
    mutationFn: async (id: string) => {
      try {
        await api.deleteFinanceEntry(id);
      } catch (error) {
        if (!alreadyDone(error, HTTP_NOT_FOUND)) throw error;
      }
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: FINANCE_QUERY_KEY });
      patchCache((entries) => entries.filter((entry) => entry.id !== id));
    },
    onError: markSaveFailed,
    onSettled: settle,
  });

  const data = query.data;
  const lancamentos = useMemo(() => (data ? data.map(toLancamento).sort(byCreation) : NO_ENTRIES), [data]);

  const add = useCallback(
    (input: LancamentoInput): Lancamento | null => {
      if (userId === null) return null;
      const item: Lancamento = { ...input, id: generateId(), criadoEm: new Date().toISOString() };
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
  const reload = useCallback(() => void query.refetch(), [query]);
  const dismissError = useCallback(() => setSaveFailed(false), [setSaveFailed]);

  // Erro de carga só conta sem dados: com a lista já na tela, uma recarga que falhou não a esconde.
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
    }),
    [lancamentos, query.isPending, query.isError, error, reload, dismissError, add, restore, marcarPaga, desmarcarPaga, remove],
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
  const queryClient = useQueryClient();
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
        } catch (error) {
          if (!alreadyDone(error, HTTP_CONFLICT)) throw error;
        }
      }
      clearLocalLancamentos(userId);
      setItems([]);
    } catch {
      setFailed(true);
    } finally {
      setImporting(false);
      // Recarrega mesmo em falha: parte dos lançamentos pode ter sido gravada antes do erro.
      await queryClient.invalidateQueries({ queryKey: FINANCE_QUERY_KEY });
    }
  }, [api, userId, items, importing, queryClient]);

  const descartar = useCallback(() => {
    if (userId === null) return;
    clearLocalLancamentos(userId);
    setItems([]);
    setFailed(false);
  }, [userId]);

  return { count: items.length, importing, failed, importar, descartar };
}
