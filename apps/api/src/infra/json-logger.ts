import type { AssistantLogger } from '../application/assistant/process-message.js';

/**
 * Uma linha JSON por chamada. Os campos são só primitivos (ids, contagens, durações, códigos):
 * o tipo não aceita objetos, então texto de conversa ou de tarefa não entra por engano.
 */
export function createJsonLogger(sink: Pick<Console, 'log' | 'error'> = console): AssistantLogger {
  return {
    info: (event, fields) => sink.log(JSON.stringify({ level: 'info', event, ...fields })),
    error: (event, fields) => sink.error(JSON.stringify({ level: 'error', event, ...fields })),
  };
}
