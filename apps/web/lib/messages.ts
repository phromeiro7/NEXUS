import { ApiError } from './api';

const GENERIC_MESSAGE = 'Algo deu errado. Tente novamente.';

/** Mensagem para cada código de erro da API (`ApiError.code`). */
const MESSAGE_BY_CODE: Record<string, string> = {
  entrada_invalida: 'Confira os campos destacados.',
  nao_encontrado: 'Não encontramos este item. Atualize a página.',
  transicao_invalida: 'Esta mudança de status não é permitida.',
  tarefa_encerrada: 'A tarefa já está encerrada.',
  corpo_muito_grande: 'Os dados enviados são grandes demais.',
  rede: 'Sem conexão com o servidor.',
  telegram_nao_configurado: 'O Telegram ainda não está configurado neste servidor.',
  em_processamento: 'Sua mensagem anterior ainda está sendo processada. Aguarde um instante e tente de novo.',
  conflito_de_evento: 'Não foi possível processar esta mensagem. Tente reenviar.',
};

/** Detalhe de `hora_invalida`: o horário cai numa mudança de horário de verão. */
const INVALID_TIME_MESSAGE_BY_REASON: Record<string, string> = {
  hora_inexistente: 'Esta hora não existe no fuso configurado (horário de verão).',
  hora_ambigua: 'Esta hora ocorre duas vezes no fuso configurado. Escolha outro horário.',
};

const ASSISTANT_DOWN_MESSAGE = 'O assistente está indisponível agora. Nada foi alterado.';

/** Mesmo limite aplicado pela API; aparece no texto do aviso. */
const MAX_MESSAGES_PER_HOUR = 30;
const SECONDS_PER_MINUTE = 60;

/** Texto amigável para qualquer erro; o que não é `ApiError` (ou tem código desconhecido) vira a mensagem genérica. */
export function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_MESSAGE;
  if (error.code === 'limite_de_mensagens') {
    const retryAfterSeconds = (error.body as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
    // Arredonda para cima e nunca mostra "0 min".
    const minutes =
      typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds)
        ? Math.max(1, Math.ceil(retryAfterSeconds / SECONDS_PER_MINUTE))
        : 1;
    return `Limite de ${MAX_MESSAGES_PER_HOUR} mensagens por hora atingido. Tente de novo em ${minutes} min.`;
  }
  if (error.code === 'assistente_indisponivel') {
    const reason = (error.body as { reason?: unknown } | null)?.reason;
    return reason === 'configuracao' ? 'O assistente ainda não está configurado.' : ASSISTANT_DOWN_MESSAGE;
  }
  if (error.code === 'hora_invalida') {
    const reason = (error.body as { reason?: unknown } | null)?.reason;
    return (typeof reason === 'string' && INVALID_TIME_MESSAGE_BY_REASON[reason]) || 'Esta hora não é válida no fuso configurado.';
  }
  return MESSAGE_BY_CODE[error.code] ?? GENERIC_MESSAGE;
}
