import type { Context } from 'hono';
import { NotFoundError } from '../application/errors.js';
import { ValidationError } from '../http-errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError([{ code: 'custom', path: [], message: 'Corpo JSON inválido ou ausente' }]);
  }
}

/** Um id malformado é tratado como recurso inexistente (mesma resposta), antes do caso de uso. */
export function idParam(c: Context, resource: 'tarefa' | 'processo' | 'feriado'): string {
  const id = c.req.param('id') ?? '';
  if (!UUID.test(id)) throw new NotFoundError(resource);
  return id;
}
