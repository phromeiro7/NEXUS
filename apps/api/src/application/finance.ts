import {
  isConsistentFinanceEntry,
  type CreateFinanceEntryInput,
  type FinanceEntryDto,
  type ListFinanceEntriesQuery,
  type UpdateFinanceEntryInput,
} from '@nexus/shared';
import { InvalidInputError, NotFoundError } from './errors.js';
import type { Clock, FinanceEntryPatch, FinanceEntryRepository } from './ports.js';

/** Casos de uso dos lançamentos financeiros; `paidAt` é sempre definido aqui, nunca pelo cliente. */
export function makeFinanceUseCases(deps: { finance: FinanceEntryRepository; clock: Clock }) {
  const { finance, clock } = deps;

  return {
    list(userId: string, query: ListFinanceEntriesQuery): Promise<FinanceEntryDto[]> {
      return finance.list(userId, query);
    },

    create(userId: string, input: CreateFinanceEntryInput): Promise<FinanceEntryDto> {
      const { id, ...fields } = input;
      return finance.create(userId, {
        ...(id !== undefined ? { id } : {}),
        ...fields,
        paidAt: fields.status === 'paga' ? clock.now().toISOString() : null,
      });
    },

    async update(userId: string, id: string, input: UpdateFinanceEntryInput): Promise<FinanceEntryDto> {
      const current = await finance.get(userId, id);
      if (current === null) throw new NotFoundError('lancamento');

      const nextStatus = input.status ?? current.status;
      if (!isConsistentFinanceEntry({ kind: current.kind, status: nextStatus })) {
        throw new InvalidInputError('lancamento_inconsistente');
      }

      const patch: FinanceEntryPatch = { ...input };
      // paidAt acompanha a situação: pagar marca o instante (uma vez só), desfazer limpa.
      const statusChanged = input.status !== undefined && input.status !== current.status;
      if (statusChanged) {
        patch.paidAt = input.status === 'paga' ? clock.now().toISOString() : null;
      }

      const updated = await finance.update(userId, id, patch);
      if (updated === null) throw new NotFoundError('lancamento');
      return updated;
    },

    async remove(userId: string, id: string): Promise<void> {
      if (!(await finance.remove(userId, id))) throw new NotFoundError('lancamento');
    },
  };
}
