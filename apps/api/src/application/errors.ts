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

export class InvalidInputError extends Error {
  constructor(readonly code: 'hora_sem_data') {
    super(`Entrada inválida: ${code}`);
    this.name = 'InvalidInputError';
  }
}
