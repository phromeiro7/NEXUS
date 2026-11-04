import {
  AssistantUnavailableError,
  ConflictError,
  EventInProgressError,
  ForeignEventError,
  InvalidInputError,
  MessageTooLongError,
  NotFoundError,
  RateLimitedError,
  TargetTasksGoneError,
  TelegramAuthError,
  TelegramNotConfiguredError,
} from './application/errors.js';
import { HoraInvalidaError } from './domain/reminders.js';
import { InvalidTransitionError } from './domain/task-status.js';

/** Entrada da requisição inválida (corpo, query). */
export class ValidationError extends Error {
  constructor(readonly issues: unknown) {
    super('Entrada inválida');
    this.name = 'ValidationError';
  }
}

export type ErrorResponse = {
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503;
  body: unknown;
  headers?: Record<string, string>;
};

/** Mapeia erros conhecidos para a resposta HTTP. Nunca expõe mensagens internas nem texto do usuário. */
export function errorResponse(err: unknown): ErrorResponse {
  if (err instanceof ValidationError) return { status: 400, body: { error: 'entrada_invalida', issues: err.issues } };
  if (err instanceof InvalidInputError) return { status: 400, body: { error: 'entrada_invalida', code: err.code } };
  if (err instanceof MessageTooLongError) {
    return { status: 400, body: { error: 'entrada_invalida', code: 'mensagem_longa_demais' } };
  }
  // Não revela qual recurso nem se pertence a outro usuário.
  if (err instanceof NotFoundError || err instanceof TargetTasksGoneError) {
    return { status: 404, body: { error: 'nao_encontrado' } };
  }
  if (err instanceof ConflictError) return { status: 409, body: { error: err.code } };
  if (err instanceof EventInProgressError) return { status: 409, body: { error: 'em_processamento' } };
  // Nunca revela de quem é o evento.
  if (err instanceof ForeignEventError) return { status: 409, body: { error: 'conflito_de_evento' } };
  if (err instanceof InvalidTransitionError) {
    return { status: 409, body: { error: 'transicao_invalida', from: err.from, to: err.to } };
  }
  if (err instanceof HoraInvalidaError) return { status: 422, body: { error: 'hora_invalida', reason: err.reason } };
  if (err instanceof RateLimitedError) {
    return {
      status: 429,
      body: { error: 'limite_de_mensagens', retryAfterSeconds: err.retryAfterSeconds },
      headers: { 'Retry-After': String(err.retryAfterSeconds) },
    };
  }
  // O que já foi gravado vira resposta 200 (parcial) no caso de uso; aqui só falhas sem escrita.
  if (err instanceof AssistantUnavailableError) {
    return { status: 503, body: { error: 'assistente_indisponivel', reason: err.reason } };
  }
  if (err instanceof TelegramAuthError) {
    if (err.code === 'login_desabilitado') return { status: 503, body: { error: err.code } };
    if (err.code === 'telegram_nao_vinculado') return { status: 403, body: { error: err.code } };
    if (err.code === 'muitas_tentativas') {
      const wait = err.retryAfterSeconds ?? 60;
      return { status: 429, body: { error: err.code, retryAfterSeconds: wait }, headers: { 'Retry-After': String(wait) } };
    }
    return { status: 401, body: { error: err.code } };
  }
  if (err instanceof TelegramNotConfiguredError) return { status: 503, body: { error: 'telegram_nao_configurado' } };
  return { status: 500, body: { error: 'erro_interno' } };
}
