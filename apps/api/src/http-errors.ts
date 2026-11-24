import {
  AssistantUnavailableError,
  ConflictError,
  EventInProgressError,
  ForbiddenError,
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

/** Espera sugerida quando o erro de limite não informa quanto tempo falta. */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

/** Entrada da requisição inválida (corpo, query). */
export class ValidationError extends Error {
  constructor(readonly issues: unknown) {
    super('Entrada inválida');
    this.name = 'ValidationError';
  }
}

/** Resposta HTTP de erro: status, corpo JSON e cabeçalhos extras (ex.: `Retry-After`). */
export type ErrorResponse = {
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503;
  body: unknown;
  headers?: Record<string, string>;
};

/** Mapeia erros conhecidos para a resposta HTTP. Nunca expõe mensagens internas nem texto do usuário. */
export function errorResponse(error: unknown): ErrorResponse {
  if (error instanceof ValidationError) return { status: 400, body: { error: 'entrada_invalida', issues: error.issues } };
  if (error instanceof InvalidInputError) return { status: 400, body: { error: 'entrada_invalida', code: error.code } };
  if (error instanceof MessageTooLongError) {
    return { status: 400, body: { error: 'entrada_invalida', code: 'mensagem_longa_demais' } };
  }
  // Não revela qual recurso nem se pertence a outro usuário.
  if (error instanceof NotFoundError || error instanceof TargetTasksGoneError) {
    return { status: 404, body: { error: 'nao_encontrado' } };
  }
  if (error instanceof ForbiddenError) return { status: 403, body: { error: 'proibido' } };
  if (error instanceof ConflictError) return { status: 409, body: { error: error.code } };
  if (error instanceof EventInProgressError) return { status: 409, body: { error: 'em_processamento' } };
  // Nunca revela de quem é o evento.
  if (error instanceof ForeignEventError) return { status: 409, body: { error: 'conflito_de_evento' } };
  if (error instanceof InvalidTransitionError) {
    return { status: 409, body: { error: 'transicao_invalida', from: error.from, to: error.to } };
  }
  if (error instanceof HoraInvalidaError) return { status: 422, body: { error: 'hora_invalida', reason: error.reason } };
  if (error instanceof RateLimitedError) {
    return {
      status: 429,
      body: { error: 'limite_de_mensagens', retryAfterSeconds: error.retryAfterSeconds },
      headers: { 'Retry-After': String(error.retryAfterSeconds) },
    };
  }
  // O que já foi gravado vira resposta 200 (parcial) no caso de uso; aqui só falhas sem escrita.
  if (error instanceof AssistantUnavailableError) {
    return { status: 503, body: { error: 'assistente_indisponivel', reason: error.reason } };
  }
  if (error instanceof TelegramAuthError) {
    if (error.code === 'login_desabilitado') return { status: 503, body: { error: error.code } };
    if (error.code === 'telegram_nao_vinculado') return { status: 403, body: { error: error.code } };
    if (error.code === 'muitas_tentativas') {
      const retryAfterSeconds = error.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
      return {
        status: 429,
        body: { error: error.code, retryAfterSeconds },
        headers: { 'Retry-After': String(retryAfterSeconds) },
      };
    }
    return { status: 401, body: { error: error.code } };
  }
  if (error instanceof TelegramNotConfiguredError) return { status: 503, body: { error: 'telegram_nao_configurado' } };
  return { status: 500, body: { error: 'erro_interno' } };
}
