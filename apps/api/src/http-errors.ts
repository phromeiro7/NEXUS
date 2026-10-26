import { ConflictError, InvalidInputError, NotFoundError } from './application/errors.js';
import { HoraInvalidaError } from './domain/reminders.js';
import { InvalidTransitionError } from './domain/task-status.js';

/** Entrada da requisição inválida (corpo, query). */
export class ValidationError extends Error {
  constructor(readonly issues: unknown) {
    super('Entrada inválida');
    this.name = 'ValidationError';
  }
}

export type ErrorResponse = { status: 400 | 404 | 409 | 422 | 500; body: unknown };

/** Mapeia erros conhecidos para a resposta HTTP. Nunca expõe mensagens internas. */
export function errorResponse(err: unknown): ErrorResponse {
  if (err instanceof ValidationError) return { status: 400, body: { error: 'entrada_invalida', issues: err.issues } };
  if (err instanceof InvalidInputError) return { status: 400, body: { error: 'entrada_invalida', code: err.code } };
  // Não revela qual recurso nem se pertence a outro usuário.
  if (err instanceof NotFoundError) return { status: 404, body: { error: 'nao_encontrado' } };
  if (err instanceof ConflictError) return { status: 409, body: { error: err.code } };
  if (err instanceof InvalidTransitionError) {
    return { status: 409, body: { error: 'transicao_invalida', from: err.from, to: err.to } };
  }
  if (err instanceof HoraInvalidaError) return { status: 422, body: { error: 'hora_invalida', reason: err.reason } };
  return { status: 500, body: { error: 'erro_interno' } };
}
