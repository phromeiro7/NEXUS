import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { ASSISTANT_TOOLS } from '../application/assistant/tools.js';
import { buildSystemBlocks } from '../application/assistant/prompt.js';
import { AssistantUnavailableError } from '../application/errors.js';
import type { ModelMessage } from '../application/ports.js';
import { createAnthropicAssistantModel } from './anthropic-assistant-model.js';

const API_KEY = 'sk-ant-chave-secreta-de-teste';
const USER_TEXT = 'texto-secreto-do-usuario-xyz';

type Params = Record<string, any>;
type CreateOpts = { signal?: AbortSignal; timeout?: number; maxRetries?: number };

function message(over: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text: 'Pronto.' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ...over,
  };
}

function setup(respond: (params: Params, opts: CreateOpts) => unknown = () => message()) {
  const calls: Array<{ params: Params; opts: CreateOpts }> = [];
  const create = vi.fn(async (params: Params, opts: CreateOpts) => {
    calls.push({ params, opts });
    return respond(params, opts);
  });
  const client = { messages: { create } } as unknown as Anthropic;
  const model = createAnthropicAssistantModel({ apiKey: API_KEY, model: 'claude-haiku-5-5', client });
  const step = (over: { messages?: ModelMessage[]; signal?: AbortSignal } = {}) =>
    model.step({
      system: buildSystemBlocks(),
      messages: over.messages ?? [{ role: 'user', content: USER_TEXT }],
      tools: ASSISTANT_TOOLS,
      signal: over.signal ?? new AbortController().signal,
    });
  return { calls, create, step };
}

function walk(node: unknown, visit: (key: string, value: unknown) => void, parentKey = ''): void {
  if (Array.isArray(node)) {
    for (const x of node) walk(x, visit, parentKey);
  } else if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      // dentro de `properties` as chaves são nomes de campos, não palavras-chave
      if (parentKey !== 'properties') visit(k, v);
      walk(v, visit, k);
    }
  }
}

describe('request shape', () => {
  it('sends the configured model and the Haiku 5.5 settings', async () => {
    const { calls, step } = setup();
    await step();
    const { params, opts } = calls[0]!;
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.max_tokens).toBe(4096);
    expect(params.output_config).toEqual({ effort: 'low' });
    expect(params.tool_choice).toEqual({ type: 'auto' });
    expect(opts.timeout).toBe(12_000);
    expect(opts.maxRetries).toBe(1);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses the model given in the options', async () => {
    const { create } = setup();
    const client = { messages: { create } } as unknown as Anthropic;
    const m = createAnthropicAssistantModel({ apiKey: API_KEY, model: 'outro-modelo', client });
    await m.step({ system: [], messages: [{ role: 'user', content: 'oi' }], tools: [], signal: new AbortController().signal });
    expect(create.mock.calls[0]![0].model).toBe('outro-modelo');
  });

  it('sends no sampling params and no prefill', async () => {
    const { calls, step } = setup();
    await step({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] });
    const { params } = calls[0]!;
    for (const key of ['temperature', 'top_p', 'top_k']) expect(params).not.toHaveProperty(key);
    expect(params.messages.at(-1).role).toBe('user');
  });

  it('refuses to send a request that ends with an assistant message (prefill)', async () => {
    const { create, step } = setup();
    await expect(step({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] })).rejects.toThrow(
      /prefill/i,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('marks the cacheable system block with cache_control and nothing else', async () => {
    const { calls, step } = setup();
    await step();
    const system = calls[0]!.params.system;
    expect(system).toHaveLength(1);
    expect(system[0]).toEqual({ type: 'text', text: buildSystemBlocks()[0]!.text, cache_control: { type: 'ephemeral' } });
  });

  it('does not add cache_control to blocks that are not flagged', async () => {
    const { create } = setup();
    const client = { messages: { create } } as unknown as Anthropic;
    const m = createAnthropicAssistantModel({ apiKey: API_KEY, model: 'm', client });
    await m.step({
      system: [{ type: 'text', text: 'a' }],
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
      signal: new AbortController().signal,
    });
    expect(create.mock.calls[0]![0].system).toEqual([{ type: 'text', text: 'a' }]);
  });
});

describe('tools sent to the model', () => {
  it('maps every tool with strict true and a closed, sanitized schema', async () => {
    const { calls, step } = setup();
    await step();
    const tools = calls[0]!.params.tools as Array<Params>;
    expect(tools.map((t) => t.name)).toEqual(ASSISTANT_TOOLS.map((t) => t.name));
    for (const [i, t] of tools.entries()) {
      expect(t.strict).toBe(true);
      expect(t.description).toBe(ASSISTANT_TOOLS[i]!.description);
      expect(t.input_schema.type).toBe('object');
      expect(t.input_schema.additionalProperties).toBe(false);
      const banned: string[] = [];
      walk(t.input_schema, (k) => {
        if (['minLength', 'maxLength', 'minimum', 'maximum', 'pattern'].includes(k)) banned.push(k);
      });
      expect(banned).toEqual([]);
    }
  });

  it('keeps required, enums and replaces the uuid pattern by format uuid', async () => {
    const { calls, step } = setup();
    await step();
    const byName = Object.fromEntries((calls[0]!.params.tools as Array<Params>).map((t) => [t.name, t]));
    expect(byName.criar_tarefa.input_schema.required).toEqual(['title']);
    expect(byName.criar_tarefa.input_schema.properties.type.enum).toEqual(['prazo', 'tarefa', 'audiencia']);
    expect(byName.concluir_tarefa.input_schema.properties.id).toEqual({ type: 'string', format: 'uuid' });
    expect(byName.alterar_tarefa.input_schema.properties.id).toEqual({ type: 'string', format: 'uuid' });
    expect(byName.calcular_prazo.input_schema.required).toEqual(['baseDate', 'days', 'countType']);
    expect(byName.calcular_prazo.input_schema.properties.days).toEqual({ type: 'integer' });
  });

  it('keeps format date on the date fields', async () => {
    const { calls, step } = setup();
    await step();
    const byName = Object.fromEntries((calls[0]!.params.tools as Array<Params>).map((t) => [t.name, t]));
    expect(byName.criar_tarefa.input_schema.properties.dueDate.format).toBe('date');
    expect(byName.listar_tarefas.input_schema.properties.from.format).toBe('date');
    expect(byName.listar_tarefas.input_schema.properties.to.format).toBe('date');
    expect(byName.calcular_prazo.input_schema.properties.baseDate.format).toBe('date');
    expect(JSON.stringify(byName.alterar_tarefa.input_schema.properties.dueDate)).toContain('"format":"date"');
  });

  it('does not mutate the original tool definitions', async () => {
    const before = JSON.stringify(ASSISTANT_TOOLS);
    const { step } = setup();
    await step();
    expect(JSON.stringify(ASSISTANT_TOOLS)).toBe(before);
    expect(before).toContain('minLength');
  });
});

describe('message conversion', () => {
  it('converts string and text content as they are', async () => {
    const { calls, step } = setup();
    await step({
      messages: [
        { role: 'user', content: 'oi' },
        { role: 'assistant', content: [{ type: 'text', text: 'olá' }] },
        { role: 'user', content: 'tchau' },
      ],
    });
    expect(calls[0]!.params.messages).toEqual([
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: [{ type: 'text', text: 'olá' }] },
      { role: 'user', content: 'tchau' },
    ]);
  });

  it('round-trips thinking blocks verbatim and in order, before tool_use', async () => {
    const thinking = { type: 'thinking', thinking: 'penso...', signature: 'sig-abc' };
    const redacted = { type: 'redacted_thinking', data: 'ENCRYPTED' };
    const { calls, step } = setup(() =>
      message({
        content: [thinking, redacted, { type: 'text', text: 'Vou criar.' }, { type: 'tool_use', id: 'toolu_1', name: 'criar_tarefa', input: { title: 'A' } }],
        stop_reason: 'tool_use',
      }),
    );
    const first = await step();
    expect(first.blocks).toEqual([
      { type: 'thinking', raw: thinking },
      { type: 'redacted_thinking', raw: redacted },
      { type: 'text', text: 'Vou criar.' },
      { type: 'tool_use', id: 'toolu_1', name: 'criar_tarefa', input: { title: 'A' } },
    ]);
    // `raw` é a própria resposta da API, não uma cópia reescrita
    expect((first.blocks[0] as { raw: unknown }).raw).toBe(thinking);

    await step({
      messages: [
        { role: 'user', content: 'crie A' },
        { role: 'assistant', content: first.blocks },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}' }] },
      ],
    });
    const sent = calls[1]!.params.messages[1];
    expect(sent).toEqual({
      role: 'assistant',
      content: [
        thinking,
        redacted,
        { type: 'text', text: 'Vou criar.' },
        { type: 'tool_use', id: 'toolu_1', name: 'criar_tarefa', input: { title: 'A' } },
      ],
    });
    expect(sent.content[0]).toBe(thinking);
    expect(sent.content[1]).toBe(redacted);
  });

  it('converts tool_result blocks into a user message with id, string content and is_error', async () => {
    const { calls, step } = setup();
    await step({
      messages: [
        { role: 'user', content: 'x' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'listar_tarefas', input: {} }, { type: 'tool_use', id: 'toolu_2', name: 'concluir_tarefa', input: { id: 'z' } }] },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"items":[]}', is_error: false },
            { type: 'tool_result', tool_use_id: 'toolu_2', content: 'id_desconhecido', is_error: true },
          ],
        },
      ],
    });
    expect(calls[0]!.params.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"items":[]}', is_error: false },
        { type: 'tool_result', tool_use_id: 'toolu_2', content: 'id_desconhecido', is_error: true },
      ],
    });
  });
});

describe('response mapping', () => {
  it.each([
    ['end_turn', 'end_turn'],
    ['tool_use', 'tool_use'],
    ['max_tokens', 'max_tokens'],
    ['refusal', 'refusal'],
  ] as const)('maps stop_reason %s', async (api, expected) => {
    const { step } = setup(() => message({ stop_reason: api }));
    expect((await step()).stopReason).toBe(expected);
  });

  it('keeps text produced before a refusal and still reports refusal', async () => {
    const { step } = setup(() => message({ stop_reason: 'refusal', content: [{ type: 'text', text: 'não posso' }] }));
    const r = await step();
    expect(r.stopReason).toBe('refusal');
    expect(r.blocks).toEqual([{ type: 'text', text: 'não posso' }]);
  });

  it('maps usage including cache_read_input_tokens', async () => {
    const { step } = setup(() =>
      message({ usage: { input_tokens: 123, output_tokens: 45, cache_read_input_tokens: 678, cache_creation_input_tokens: 9 } }),
    );
    expect((await step()).usage).toEqual({ inputTokens: 123, outputTokens: 45, cacheReadTokens: 678 });
  });

  it('treats a missing cache_read_input_tokens as zero', async () => {
    const { step } = setup(() => message({ usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: null } }));
    expect((await step()).usage).toEqual({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 0 });
  });
});

describe('error mapping', () => {
  const H = new Headers();
  const cases: Array<[string, () => Error, string]> = [
    ['RateLimitError', () => new Anthropic.RateLimitError(429, { type: 'error' }, USER_TEXT, H), 'limite'],
    ['APIConnectionError', () => new Anthropic.APIConnectionError({ message: USER_TEXT }), 'rede'],
    ['APIConnectionTimeoutError', () => new Anthropic.APIConnectionTimeoutError({ message: USER_TEXT }), 'timeout'],
    ['InternalServerError 500', () => new Anthropic.InternalServerError(500, { type: 'error' }, USER_TEXT, H), 'servico'],
    ['InternalServerError 529', () => new Anthropic.InternalServerError(529, { type: 'error' }, USER_TEXT, H), 'servico'],
    ['AuthenticationError', () => new Anthropic.AuthenticationError(401, { type: 'error' }, USER_TEXT, H), 'configuracao'],
    ['PermissionDeniedError', () => new Anthropic.PermissionDeniedError(403, { type: 'error' }, USER_TEXT, H), 'configuracao'],
    ['BadRequestError', () => new Anthropic.BadRequestError(400, { type: 'error' }, USER_TEXT, H), 'configuracao'],
  ];

  it.each(cases)('%s -> reason', async (_name, make, reason) => {
    const { step } = setup(() => {
      throw make();
    });
    const err = await step().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AssistantUnavailableError);
    expect((err as AssistantUnavailableError).reason).toBe(reason);
    expect((err as AssistantUnavailableError).partial).toEqual([]);
  });

  it('maps by class, not by message text', async () => {
    const { step } = setup(() => {
      throw new Anthropic.APIConnectionError({ message: 'rate limit timeout 429 500' });
    });
    await expect(step()).rejects.toMatchObject({ reason: 'rede' });
  });

  it('maps an aborted signal to timeout, with or without calling the API', async () => {
    const ac = new AbortController();
    ac.abort();
    const pre = setup();
    await expect(pre.step({ signal: ac.signal })).rejects.toMatchObject({ reason: 'timeout' });

    const ac2 = new AbortController();
    const mid = setup(() => {
      ac2.abort();
      throw new Anthropic.APIUserAbortError();
    });
    await expect(mid.step({ signal: ac2.signal })).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('never leaks the key, the user text or the SDK message into the error', async () => {
    for (const [, make] of cases) {
      const { step } = setup(() => {
        throw make();
      });
      const err = (await step().then(
        () => null,
        (e: unknown) => e,
      )) as AssistantUnavailableError;
      const dump = `${err.message} ${err.name} ${JSON.stringify(err)} ${err.stack ?? ''}`;
      expect(dump).not.toContain(API_KEY);
      expect(dump).not.toContain(USER_TEXT);
      expect(err.message).toBe(`Assistente indisponível: ${err.reason}`);
      expect(err.cause).toBeUndefined();
    }
  });

  it('does not wrap unexpected non-SDK errors', async () => {
    const { step } = setup(() => {
      throw new TypeError('bug');
    });
    await expect(step()).rejects.toBeInstanceOf(TypeError);
  });
});
