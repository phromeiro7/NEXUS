import { ApiError } from './api';

const GENERIC = 'Algo deu errado. Tente novamente.';

const BY_CODE: Record<string, string> = {
  entrada_invalida: 'Confira os campos destacados.',
  nao_encontrado: 'Não encontramos este item. Atualize a página.',
  transicao_invalida: 'Esta mudança de status não é permitida.',
  tarefa_encerrada: 'A tarefa já está encerrada.',
  numero_ja_cadastrado: 'Já existe um processo com este número.',
  feriado_ja_cadastrado: 'Este feriado já está cadastrado.',
  corpo_muito_grande: 'Os dados enviados são grandes demais.',
  rede: 'Sem conexão com o servidor.',
};

const HORA_BY_REASON: Record<string, string> = {
  hora_inexistente: 'Esta hora não existe no fuso configurado (horário de verão).',
  hora_ambigua: 'Esta hora ocorre duas vezes no fuso configurado. Escolha outro horário.',
};

export function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC;
  if (error.code === 'hora_invalida') {
    const reason = (error.body as { reason?: unknown } | null)?.reason;
    return (typeof reason === 'string' && HORA_BY_REASON[reason]) || 'Esta hora não é válida no fuso configurado.';
  }
  return BY_CODE[error.code] ?? GENERIC;
}
