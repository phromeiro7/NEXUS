import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { messageFor } from './messages';

const err = (status: number, code: string, body: unknown = { error: code }) =>
  new ApiError(status, code, body);

describe('messageFor', () => {
  it.each([
    [400, 'entrada_invalida', 'Confira os campos destacados.'],
    [404, 'nao_encontrado', 'Não encontramos este item. Atualize a página.'],
    [409, 'transicao_invalida', 'Esta mudança de status não é permitida.'],
    [409, 'tarefa_encerrada', 'A tarefa já está encerrada.'],
    [413, 'corpo_muito_grande', 'Os dados enviados são grandes demais.'],
    [503, 'telegram_nao_configurado', 'O Telegram ainda não está configurado neste servidor.'],
    [0, 'rede', 'Sem conexão com o servidor.'],
    [500, 'erro_interno', 'Algo deu errado. Tente novamente.'],
    [418, 'qualquer_coisa', 'Algo deu errado. Tente novamente.'],
  ])('%i %s', (status, code, text) => {
    expect(messageFor(err(status, code))).toBe(text);
  });

  it('maps assistant errors', () => {
    expect(messageFor(err(429, 'limite_de_mensagens', { error: 'limite_de_mensagens', retryAfterSeconds: 90 }))).toBe(
      'Limite de 30 mensagens por hora atingido. Tente de novo em 2 min.',
    );
    expect(messageFor(err(429, 'limite_de_mensagens', { error: 'limite_de_mensagens', retryAfterSeconds: 60 }))).toBe(
      'Limite de 30 mensagens por hora atingido. Tente de novo em 1 min.',
    );
    expect(messageFor(err(429, 'limite_de_mensagens', { error: 'limite_de_mensagens', retryAfterSeconds: 1 }))).toBe(
      'Limite de 30 mensagens por hora atingido. Tente de novo em 1 min.',
    );
    expect(messageFor(err(429, 'limite_de_mensagens', null))).toBe(
      'Limite de 30 mensagens por hora atingido. Tente de novo em 1 min.',
    );
    expect(messageFor(err(503, 'assistente_indisponivel', { error: 'assistente_indisponivel', reason: 'configuracao' }))).toBe(
      'O assistente ainda não está configurado.',
    );
    for (const reason of ['limite', 'rede', 'timeout', 'servico']) {
      expect(messageFor(err(503, 'assistente_indisponivel', { error: 'assistente_indisponivel', reason }))).toBe(
        'O assistente está indisponível agora. Nada foi alterado.',
      );
    }
    expect(messageFor(err(503, 'assistente_indisponivel', null))).toBe(
      'O assistente está indisponível agora. Nada foi alterado.',
    );
    expect(messageFor(err(409, 'em_processamento'))).toBe(
      'Sua mensagem anterior ainda está sendo processada. Aguarde um instante e tente de novo.',
    );
    expect(messageFor(err(409, 'conflito_de_evento'))).toBe('Não foi possível processar esta mensagem. Tente reenviar.');
  });

  it('distinguishes hora_invalida reasons', () => {
    const inexistente = messageFor(
      err(422, 'hora_invalida', { error: 'hora_invalida', reason: 'hora_inexistente' }),
    );
    const ambigua = messageFor(
      err(422, 'hora_invalida', { error: 'hora_invalida', reason: 'hora_ambigua' }),
    );
    expect(inexistente).toBe('Esta hora não existe no fuso configurado (horário de verão).');
    expect(ambigua).toBe('Esta hora ocorre duas vezes no fuso configurado. Escolha outro horário.');
    expect(inexistente).not.toBe(ambigua);
  });

  it('uses a generic hora_invalida message when the reason is missing', () => {
    expect(messageFor(err(422, 'hora_invalida'))).toBe('Esta hora não é válida no fuso configurado.');
  });

  it('handles non-ApiError values', () => {
    expect(messageFor(new Error('x'))).toBe('Algo deu errado. Tente novamente.');
    expect(messageFor('x')).toBe('Algo deu errado. Tente novamente.');
    expect(messageFor(undefined)).toBe('Algo deu errado. Tente novamente.');
  });
});
