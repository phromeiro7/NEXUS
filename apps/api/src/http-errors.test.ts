import { describe, expect, it } from 'vitest';
import {
  AssistantUnavailableError,
  ConflictError,
  EventInProgressError,
  EventStateError,
  ForeignEventError,
  InvalidInputError,
  LinkCodeCollisionError,
  MessageTooLongError,
  NotFoundError,
  RateLimitedError,
  TargetTasksGoneError,
  TelegramNotConfiguredError,
} from './application/errors.js';
import { InvalidTransitionError } from './domain/task-status.js';
import { InvalidLocalTimeError } from './domain/reminders.js';
import { toErrorResponse, ValidationError } from './http-errors.js';

describe('toErrorResponse (telegram)', () => {
  it('TelegramNotConfiguredError -> 503 telegram_nao_configurado', () => {
    expect(toErrorResponse(new TelegramNotConfiguredError())).toEqual({
      status: 503,
      body: { error: 'telegram_nao_configurado' },
    });
  });

  it('LinkCodeCollisionError stays a generic 500', () => {
    expect(toErrorResponse(new LinkCodeCollisionError())).toEqual({ status: 500, body: { error: 'erro_interno' } });
  });
});

describe('toErrorResponse', () => {
  it('ValidationError -> 400 entrada_invalida with issues', () => {
    const issues = [{ path: ['title'], message: 'x' }];
    expect(toErrorResponse(new ValidationError(issues))).toEqual({
      status: 400,
      body: { error: 'entrada_invalida', issues },
    });
  });

  it('InvalidInputError -> 400 entrada_invalida with code', () => {
    expect(toErrorResponse(new InvalidInputError('hora_sem_data'))).toEqual({
      status: 400,
      body: { error: 'entrada_invalida', code: 'hora_sem_data' },
    });
  });

  it.each(['tarefa', 'lancamento'] as const)('NotFoundError(%s) -> 404 without revealing the resource', (r) => {
    expect(toErrorResponse(new NotFoundError(r))).toEqual({ status: 404, body: { error: 'nao_encontrado' } });
  });

  it('ConflictError -> 409 with its code', () => {
    expect(toErrorResponse(new ConflictError('tarefa_encerrada'))).toEqual({
      status: 409,
      body: { error: 'tarefa_encerrada' },
    });
    expect(toErrorResponse(new ConflictError('lancamento_ja_cadastrado'))).toEqual({
      status: 409,
      body: { error: 'lancamento_ja_cadastrado' },
    });
  });

  it('InvalidTransitionError -> 409 transicao_invalida with from/to', () => {
    expect(toErrorResponse(new InvalidTransitionError('concluida', 'em_andamento'))).toEqual({
      status: 409,
      body: { error: 'transicao_invalida', from: 'concluida', to: 'em_andamento' },
    });
  });

  it('InvalidLocalTimeError -> 422 hora_invalida with reason', () => {
    expect(toErrorResponse(new InvalidLocalTimeError('hora_ambigua'))).toEqual({
      status: 422,
      body: { error: 'hora_invalida', reason: 'hora_ambigua' },
    });
  });

  it('RateLimitedError -> 429 with retryAfterSeconds and a Retry-After header', () => {
    expect(toErrorResponse(new RateLimitedError(60))).toEqual({
      status: 429,
      body: { error: 'limite_de_mensagens', retryAfterSeconds: 60 },
      headers: { 'Retry-After': '60' },
    });
  });

  it('MessageTooLongError -> 400 entrada_invalida without echoing anything', () => {
    expect(toErrorResponse(new MessageTooLongError(1000))).toEqual({
      status: 400,
      body: { error: 'entrada_invalida', code: 'mensagem_longa_demais' },
    });
  });

  it('InvalidInputError(mensagem_vazia) -> 400 entrada_invalida', () => {
    expect(toErrorResponse(new InvalidInputError('mensagem_vazia'))).toEqual({
      status: 400,
      body: { error: 'entrada_invalida', code: 'mensagem_vazia' },
    });
  });

  it('EventInProgressError -> 409 em_processamento', () => {
    expect(toErrorResponse(new EventInProgressError())).toEqual({ status: 409, body: { error: 'em_processamento' } });
  });

  it('ForeignEventError -> 409 conflito_de_evento, never revealing whose event', () => {
    expect(toErrorResponse(new ForeignEventError())).toEqual({ status: 409, body: { error: 'conflito_de_evento' } });
  });

  it('TargetTasksGoneError -> 404 nao_encontrado', () => {
    expect(toErrorResponse(new TargetTasksGoneError())).toEqual({ status: 404, body: { error: 'nao_encontrado' } });
  });

  it.each(['limite', 'rede', 'timeout', 'servico', 'configuracao'] as const)(
    'AssistantUnavailableError(%s) -> 503 with the reason and no partial list',
    (reason) => {
      const r = toErrorResponse(new AssistantUnavailableError(reason, []));
      expect(r).toEqual({ status: 503, body: { error: 'assistente_indisponivel', reason } });
    },
  );

  it('EventStateError -> 500 generic', () => {
    expect(toErrorResponse(new EventStateError('evento_em_estado_invalido'))).toEqual({
      status: 500,
      body: { error: 'erro_interno' },
    });
  });

  it('unknown Error -> 500 generic, never the message', () => {
    const r = toErrorResponse(new Error('relation "tasks" violates constraint x'));
    expect(r).toEqual({ status: 500, body: { error: 'erro_interno' } });
    expect(JSON.stringify(r)).not.toContain('constraint');
  });

  it('non-Error value -> 500 generic', () => {
    expect(toErrorResponse('x')).toEqual({ status: 500, body: { error: 'erro_interno' } });
  });
});
