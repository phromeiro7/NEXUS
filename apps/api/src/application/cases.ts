import type { CaseDto, CreateCaseInput, UpdateCaseInput } from '@nexus/shared';
import { NotFoundError } from './errors.js';
import type { CaseRepository } from './ports.js';

export function makeCaseUseCases(deps: { cases: CaseRepository }) {
  return {
    create(userId: string, input: CreateCaseInput): Promise<CaseDto> {
      return deps.cases.create(userId, input);
    },

    list(userId: string, filter: { status?: 'ativo' | 'arquivado' }): Promise<CaseDto[]> {
      return deps.cases.list(userId, filter);
    },

    async get(userId: string, id: string): Promise<CaseDto> {
      const found = await deps.cases.get(userId, id);
      if (found === null) throw new NotFoundError('processo');
      return found;
    },

    async update(userId: string, id: string, input: UpdateCaseInput): Promise<CaseDto> {
      const updated = await deps.cases.update(userId, id, input);
      if (updated === null) throw new NotFoundError('processo');
      return updated;
    },
  };
}
