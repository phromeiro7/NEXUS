import { ApiError } from './api';

const GENERIC = 'Algo deu errado. Tente novamente.';

const BY_CODE: Record<string, string> = {
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

const HORA_BY_REASON: Record<string, string> = {
  hora_inexistente: 'Esta hora não existe no fuso configurado (horário de verão).',
  hora_ambigua: 'Esta hora ocorre duas vezes no fuso configurado. Escolha outro horário.',
};

const ASSISTANT_DOWN = 'O assistente está indisponível agora. Nada foi alterado.';

export function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC;
  if (error.code === 'limite_de_mensagens') {
    const secs = (error.body as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
    const minutes = typeof secs === 'number' && Number.isFinite(secs) ? Math.max(1, Math.ceil(secs / 60)) : 1;
    return `Limite de 30 mensagens por hora atingido. Tente de novo em ${minutes} min.`;
  }
  if (error.code === 'assistente_indisponivel') {
    const reason = (error.body as { reason?: unknown } | null)?.reason;
    return reason === 'configuracao' ? 'O assistente ainda não está configurado.' : ASSISTANT_DOWN;
  }
  if (error.code === 'hora_invalida') {
    const reason = (error.body as { reason?: unknown } | null)?.reason;
    return (typeof reason === 'string' && HORA_BY_REASON[reason]) || 'Esta hora não é válida no fuso configurado.';
  }
  return BY_CODE[error.code] ?? GENERIC;
}
