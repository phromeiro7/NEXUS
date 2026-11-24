import type { TaskDto } from '@nexus/shared';

/** O recurso não existe para este usuário (→ 404); não distingue "de outro usuário" de "inexistente". */
export class NotFoundError extends Error {
  constructor(readonly resource: 'tarefa' | 'lancamento' | 'convite' | 'login') {
    super(`Não encontrado: ${resource}`);
    this.name = 'NotFoundError';
  }
}

/** A operação contradiz o estado atual do recurso (→ 409). */
export class ConflictError extends Error {
  constructor(readonly code: 'tarefa_encerrada' | 'lancamento_ja_cadastrado' | 'convite_de_administrador') {
    super(`Conflito: ${code}`);
    this.name = 'ConflictError';
  }
}

/** O mesmo `externalId` já pertence a outro usuário; a resposta dele nunca é devolvida. */
export class ForeignEventError extends Error {
  constructor() {
    super('Evento de outro usuário');
    this.name = 'ForeignEventError';
  }
}

/**
 * Falha de infraestrutura ANTES de o update do Telegram ser registrado (consulta do vínculo ou registro
 * do evento): nada foi feito nem respondido, então a rota devolve 500 e o Telegram reenvia. Guarda só o
 * nome do erro original, nunca a mensagem.
 */
export class UpdateNotRegisteredError extends Error {
  readonly causeName: string;
  constructor(cause: unknown) {
    super('Update do Telegram não registrado');
    this.name = 'UpdateNotRegisteredError';
    this.causeName = cause instanceof Error ? cause.name : 'desconhecido';
  }
}

/** Transição de evento inválida: evento inexistente, estado que não a permite, ou usuário ausente. */
export class EventStateError extends Error {
  constructor(readonly code: 'evento_inexistente' | 'evento_em_estado_invalido' | 'usuario_obrigatorio') {
    super(`Evento: ${code}`);
    this.name = 'EventStateError';
  }
}

/**
 * O modelo de IA não pôde responder. `reason` é o motivo para o cliente; `partial` guarda o que
 * já foi gravado por ferramentas bem-sucedidas (preenchido pelo ciclo do assistente). A mensagem
 * nunca contém texto do usuário nem a chave.
 */
export type AssistantUnavailableReason = 'limite' | 'rede' | 'timeout' | 'servico' | 'configuracao';

export class AssistantUnavailableError extends Error {
  constructor(
    readonly reason: AssistantUnavailableReason,
    public partial: TaskDto[] = [],
  ) {
    super(`Assistente indisponível: ${reason}`);
    this.name = 'AssistantUnavailableError';
  }
}

/** Entrada válida no formato, mas incoerente pelas regras de negócio (→ 400). */
export class InvalidInputError extends Error {
  constructor(readonly code: 'hora_sem_data' | 'lancamento_inconsistente' | 'mensagem_vazia') {
    super(`Entrada inválida: ${code}`);
    this.name = 'InvalidInputError';
  }
}

/** Mensagem acima do limite de caracteres (→ 400). */
export class MessageTooLongError extends Error {
  constructor(readonly maxChars: number) {
    super(`Mensagem acima de ${maxChars} caracteres`);
    this.name = 'MessageTooLongError';
  }
}

/** Limite de mensagens por hora atingido (→ 429). */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Limite de mensagens por hora atingido');
    this.name = 'RateLimitedError';
  }
}

/** O mesmo evento já está sendo processado (ou ficou preso nesse estado); a resposta ainda não existe. */
export class EventInProgressError extends Error {
  constructor() {
    super('Evento em processamento');
    this.name = 'EventInProgressError';
  }
}

/**
 * A reserva do lembrete foi perdida (inexistente, fora de `enviando` ou reservado por outro
 * envio). O remetente trata como benigno: registra o código e descarta, sem nova tentativa.
 */
export class ReminderLeaseError extends Error {
  constructor(readonly code: 'lembrete_inexistente' | 'lembrete_reservado_por_outro' | 'lembrete_em_estado_invalido') {
    super(`Lembrete: ${code}`);
    this.name = 'ReminderLeaseError';
  }
}

/** O código de vínculo gerado já existe (violação de unicidade em `link_codes`): gere outro. */
export class LinkCodeCollisionError extends Error {
  constructor() {
    super('Código de vínculo já existe');
    this.name = 'LinkCodeCollisionError';
  }
}

/** Sem `TELEGRAM_BOT_USERNAME` não há link de vínculo (→ 503). */
export class TelegramNotConfiguredError extends Error {
  constructor() {
    super('Telegram não configurado');
    this.name = 'TelegramNotConfiguredError';
  }
}

/** Todas as tarefas-alvo de uma resposta foram apagadas ou não são do usuário. */
export class TargetTasksGoneError extends Error {
  constructor() {
    super('Tarefas-alvo não encontradas');
    this.name = 'TargetTasksGoneError';
  }
}

/**
 * Falha do login pelo Telegram. `code` é o que o cliente recebe; nada aqui carrega `initData`, token ou
 * identificador do usuário. `retryAfterSeconds` só vale para 'muitas_tentativas'.
 */
export class TelegramAuthError extends Error {
  constructor(
    readonly code:
      | 'login_desabilitado'
      | 'assinatura_invalida'
      | 'sessao_expirada'
      | 'ja_utilizado'
      | 'telegram_nao_vinculado'
      | 'muitas_tentativas',
    readonly retryAfterSeconds?: number,
  ) {
    super(`Login pelo Telegram: ${code}`);
    this.name = 'TelegramAuthError';
  }
}

/** Só administradores criam, listam e revogam convites (→ 403). */
export class ForbiddenError extends Error {
  constructor() {
    super('Apenas administradores');
    this.name = 'ForbiddenError';
  }
}

/** O código de convite gerado já existe (violação de unicidade em `invites`): gere outro. */
export class InviteCodeCollisionError extends Error {
  constructor() {
    super('Código de convite já existe');
    this.name = 'InviteCodeCollisionError';
  }
}

/** O `telegram_chat_id` já pertence a outra conta (corrida entre dois aceites do mesmo Telegram). */
export class ChatAlreadyLinkedError extends Error {
  constructor() {
    super('Telegram já vinculado');
    this.name = 'ChatAlreadyLinkedError';
  }
}
