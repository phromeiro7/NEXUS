import type { CreateFinanceEntryInput, FinanceEntryDto, UpdateFinanceEntryInput } from "@nexus/shared";
import { vi } from "vitest";
import { ApiError } from "@/lib/api";

/** API de lançamentos em memória, com as mesmas respostas de erro da real (409 repetido, 404 ausente). */
export function createFakeFinanceApi() {
  const rows = new Map<string, FinanceEntryDto>();
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 4, 12, 0, tick++)).toISOString();

  const api = {
    listFinanceEntries: vi.fn(async () => [...rows.values()]),
    createFinanceEntry: vi.fn(async (input: CreateFinanceEntryInput) => {
      const id = input.id ?? crypto.randomUUID();
      if (rows.has(id)) throw new ApiError(409, "lancamento_ja_cadastrado", null);
      const now = stamp();
      const dto: FinanceEntryDto = {
        id,
        kind: input.kind,
        description: input.description,
        amountCents: input.amountCents,
        category: input.category,
        dueDate: input.dueDate,
        status: input.status,
        reminderTime: input.reminderTime,
        paidAt: input.status === "paga" ? now : null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(id, dto);
      return dto;
    }),
    updateFinanceEntry: vi.fn(async (id: string, input: UpdateFinanceEntryInput) => {
      const row = rows.get(id);
      if (!row) throw new ApiError(404, "nao_encontrado", null);
      const next: FinanceEntryDto = {
        ...row,
        ...(input.status !== undefined ? { status: input.status, paidAt: input.status === "paga" ? stamp() : null } : {}),
        updatedAt: stamp(),
      };
      rows.set(id, next);
      return next;
    }),
    deleteFinanceEntry: vi.fn(async (id: string) => {
      if (!rows.delete(id)) throw new ApiError(404, "nao_encontrado", null);
    }),
  };

  function seed(over: Partial<FinanceEntryDto> & Pick<FinanceEntryDto, "kind" | "description" | "amountCents">): FinanceEntryDto {
    const now = stamp();
    const dto: FinanceEntryDto = {
      id: crypto.randomUUID(),
      category: null,
      dueDate: "2026-11-04",
      status: "paga",
      reminderTime: null,
      paidAt: over.status === "a_pagar" ? null : now,
      createdAt: now,
      updatedAt: now,
      ...over,
    };
    rows.set(dto.id, dto);
    return dto;
  }

  return { api, rows, seed };
}
