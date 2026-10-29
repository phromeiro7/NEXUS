export class NotFoundError extends Error {
  constructor(readonly resource: 'tarefa' | 'processo' | 'feriado') {
    super(`Não encontrado: ${resource}`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(readonly code: 'tarefa_encerrada' | 'numero_ja_cadastrado' | 'feriado_ja_cadastrado') {
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

/** Transição de evento inválida: evento inexistente, estado que não a permite, ou usuário ausente. */
export class EventStateError extends Error {
  constructor(readonly code: 'evento_inexistente' | 'evento_em_estado_invalido' | 'usuario_obrigatorio') {
    super(`Evento: ${code}`);
    this.name = 'EventStateError';
  }
}

export class InvalidInputError extends Error {
  constructor(readonly code: 'hora_sem_data') {
    super(`Entrada inválida: ${code}`);
    this.name = 'InvalidInputError';
  }
}
