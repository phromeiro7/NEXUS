import type { AssistantReplyDto } from '@nexus/shared';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import {
  AssistantUnavailableError,
  EventInProgressError,
  EventStateError,
  ForeignEventError,
  MessageTooLongError,
  RateLimitedError,
  TargetTasksGoneError,
} from '../application/errors.js';
import type { ProcessMessageInput } from '../application/assistant/process-message.js';
import { buildApp, headers, req } from '../../test/harness.js';

const ID = '3f2b8c1e-5d4a-4b7e-9a10-2c6d8e4f1a77';
const SECRET_TEXT = 'SEGREDO-do-cliente-Fulano-123';
const reply: AssistantReplyDto = { reply: 'Pronto.', affectedTasks: [] };

type Fake = (input: ProcessMessageInput) => Promise<AssistantReplyDto>;

function build(fake?: Fake) {
  const calls: ProcessMessageInput[] = [];
  const processMessage: Fake | undefined = fake
    ? async (input) => {
        calls.push(input);
        return fake(input);
      }
    : undefined;
  const { app } = buildApp(processMessage ? { processMessage } : {});
  return { app, calls };
}

const send = (app: ReturnType<typeof build>['app'], body: unknown, token = 'token-ok') =>
  req(app, 'POST', '/assistant/message', body, token);

let spies: MockInstance[] = [];
beforeEach(() => {
  spies = [
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'info').mockImplementation(() => undefined),
  ];
});
afterEach(() => vi.restoreAllMocks());

const consoleOutput = () => JSON.stringify(spies.flatMap((s) => s.mock.calls));

describe('POST /assistant/message', () => {
  it('returns 200 with the reply and passes the token user, the channel and the client id', async () => {
    const { app, calls } = build(async () => reply);
    const res = await send(app, { text: '  reunião amanhã  ', clientMessageId: ID });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(reply);
    expect(calls).toEqual([
      { userId: 'u1', channel: 'painel', externalId: ID, text: 'reunião amanhã', source: 'painel' },
    ]);
  });

  it('takes the user only from the token, never from the body', async () => {
    const { app, calls } = build(async () => reply);
    await send(app, { text: 'oi', clientMessageId: ID, userId: 'u1', user_id: 'u1', channel: 'telegram' }, 'token-u2');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.userId).toBe('u2');
    expect(calls[0]!.channel).toBe('painel');
    expect(calls[0]!.source).toBe('painel');
  });

  it('401 without a token, before validation and without calling processMessage', async () => {
    const { app, calls } = build(async () => reply);
    const res = await app.request('/assistant/message', { method: 'POST', body: 'nao e json' });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['empty text', { text: '', clientMessageId: ID }],
    ['blank text', { text: '   ', clientMessageId: ID }],
    ['1001 characters', { text: 'a'.repeat(1001), clientMessageId: ID }],
    ['bad clientMessageId', { text: 'oi', clientMessageId: 'abc' }],
    ['missing clientMessageId', { text: 'oi' }],
    ['text not a string', { text: 5, clientMessageId: ID }],
  ])('400 entrada_invalida for %s, without calling processMessage', async (_name, body) => {
    const { app, calls } = build(async () => reply);
    const res = await send(app, body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('entrada_invalida');
    expect(calls).toHaveLength(0);
  });

  it('accepts exactly 1000 characters', async () => {
    const { app } = build(async () => reply);
    expect((await send(app, { text: 'a'.repeat(1000), clientMessageId: ID })).status).toBe(200);
  });

  it('400 for a body that is not JSON', async () => {
    const { app } = build(async () => reply);
    const res = await send(app, 'isso nao e json');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('entrada_invalida');
  });

  it('keeps the 64 KB body limit (413 corpo_muito_grande)', async () => {
    const { app, calls } = build(async () => reply);
    const res = await send(app, { text: 'a'.repeat(70 * 1024), clientMessageId: ID });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'corpo_muito_grande' });
    expect(calls).toHaveLength(0);
  });

  it('429 with Retry-After and the body', async () => {
    const { app } = build(async () => {
      throw new RateLimitedError(60);
    });
    const res = await send(app, { text: 'oi', clientMessageId: ID });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(await res.json()).toEqual({ error: 'limite_de_mensagens', retryAfterSeconds: 60 });
  });

  it('409 em_processamento', async () => {
    const { app } = build(async () => {
      throw new EventInProgressError();
    });
    const res = await send(app, { text: 'oi', clientMessageId: ID });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'em_processamento' });
  });

  it('409 conflito_de_evento', async () => {
    const { app } = build(async () => {
      throw new ForeignEventError();
    });
    const res = await send(app, { text: 'oi', clientMessageId: ID });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflito_de_evento' });
  });

  it('404 when the target tasks are gone', async () => {
    const { app } = build(async () => {
      throw new TargetTasksGoneError();
    });
    const res = await send(app, { text: 'oi', clientMessageId: ID });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'nao_encontrado' });
  });

  it('400 when the use case itself finds the message too long', async () => {
    const { app } = build(async () => {
      throw new MessageTooLongError(1000);
    });
    const res = await send(app, { text: 'oi', clientMessageId: ID });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('entrada_invalida');
  });

  it('503 assistente_indisponivel with the reason and no partial list', async () => {
    const { app } = build(async () => {
      throw new AssistantUnavailableError('timeout', []);
    });
    const res = await send(app, { text: 'oi', clientMessageId: ID });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'assistente_indisponivel', reason: 'timeout' });
  });

  it('503 configuracao when the assistant is disabled; other routes keep working', async () => {
    const { app } = build();
    const res = await send(app, { text: 'oi', clientMessageId: ID });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'assistente_indisponivel', reason: 'configuracao' });
    expect((await req(app, 'GET', '/me')).status).toBe(200);
    expect((await app.request('/health')).status).toBe(200);
  });

  it('disabled assistant still requires auth and validates input first', async () => {
    const { app } = build();
    expect((await app.request('/assistant/message', { method: 'POST' })).status).toBe(401);
    expect((await send(app, { text: '', clientMessageId: ID })).status).toBe(400);
  });

  it('500 erro_interno for anything else, logging neither the user text nor the error message', async () => {
    const { app } = build(async (input) => {
      throw new EventStateError(`evento_em_estado_invalido ${input.text}` as never);
    });
    const res = await send(app, { text: SECRET_TEXT, clientMessageId: ID });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'erro_interno' });
    expect(spies[0]!.mock.calls.length).toBeGreaterThan(0);
    expect(consoleOutput()).not.toContain(SECRET_TEXT);
  });

  it('never echoes the user text, internal messages or stacks in any response or console output', async () => {
    const failures: Array<() => Error> = [
      () => new RateLimitedError(60),
      () => new EventInProgressError(),
      () => new ForeignEventError(),
      () => new TargetTasksGoneError(),
      () => new MessageTooLongError(1000),
      () => new AssistantUnavailableError('servico', []),
      () => new Error(`relation "tasks" violates constraint ${SECRET_TEXT}`),
      () => new EventStateError('evento_inexistente'),
    ];
    for (const make of failures) {
      const { app } = build(async () => {
        throw make();
      });
      const res = await send(app, { text: SECRET_TEXT, clientMessageId: ID });
      const body = await res.text();
      expect(body).not.toContain(SECRET_TEXT);
      expect(body).not.toContain('constraint');
      expect(body).not.toContain('at ');
      expect(res.headers.get('Retry-After') ?? '').not.toContain(SECRET_TEXT);
    }
    expect(consoleOutput()).not.toContain(SECRET_TEXT);
  });

  it('keeps CORS and the JSON content type on the route', async () => {
    const { app } = build(async () => reply);
    const res = await app.request('/assistant/message', {
      method: 'POST',
      headers: { ...headers(), Origin: 'http://localhost:3000' },
      body: JSON.stringify({ text: 'oi', clientMessageId: ID }),
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });
});
