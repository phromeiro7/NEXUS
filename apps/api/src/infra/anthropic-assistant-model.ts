import Anthropic from '@anthropic-ai/sdk';
import { AssistantUnavailableError, type AssistantUnavailableReason } from '../application/errors.js';
import type { AssistantModel, ContentBlock, ModelMessage, ModelStep, ToolDefinition } from '../application/ports.js';

const MAX_TOKENS = 4096;
const CALL_TIMEOUT_MS = 12_000;
const MAX_RETRIES = 1;

/** Palavras-chave que o modo `strict` não aceita; o Zod continua validando tudo no servidor. */
const STRICT_UNSUPPORTED = new Set(['minLength', 'maxLength', 'minimum', 'maximum', 'pattern']);
const UUID_PATTERN_HINT = '[0-9a-fA-F]{8}-';

/** Cópia do JSON Schema sem as palavras-chave não suportadas pelo modo `strict`. */
function sanitizeSchema(node: unknown, insideProperties = false): unknown {
  if (Array.isArray(node)) return node.map((x) => sanitizeSchema(x));
  if (node === null || typeof node !== 'object') return node;
  const source = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    // Dentro de `properties` as chaves são nomes de campos, não palavras-chave.
    if (!insideProperties && STRICT_UNSUPPORTED.has(key)) continue;
    out[key] = sanitizeSchema(value, !insideProperties && key === 'properties');
  }
  if (
    !insideProperties &&
    typeof source.pattern === 'string' &&
    source.pattern.includes(UUID_PATTERN_HINT) &&
    out.format === undefined
  ) {
    out.format = 'uuid';
  }
  return out;
}

function toTool(tool: ToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: sanitizeSchema(tool.inputSchema) as Anthropic.Tool.InputSchema,
    strict: true,
  };
}

function toBlockParam(block: ContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case 'thinking':
    case 'redacted_thinking':
      // Devolvido VERBATIM, como a API o enviou.
      return block.raw as Anthropic.ContentBlockParam;
    case 'text':
      return { type: 'text', text: block.text };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: block.content,
        ...(block.is_error !== undefined ? { is_error: block.is_error } : {}),
      };
  }
}

function toMessages(messages: ModelMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : m.content.map(toBlockParam),
  }));
}

function toStopReason(reason: Anthropic.StopReason | null): ModelStep['stopReason'] {
  switch (reason) {
    case 'tool_use':
    case 'max_tokens':
    case 'refusal':
      return reason;
    case 'model_context_window_exceeded':
      return 'max_tokens';
    default:
      // end_turn, stop_sequence, pause_turn (sem ferramentas de servidor) e nulo.
      return 'end_turn';
  }
}

function toStep(message: Anthropic.Message): ModelStep {
  const blocks: ModelStep['blocks'] = [];
  for (const block of message.content) {
    if (block.type === 'text') blocks.push({ type: 'text', text: block.text });
    else if (block.type === 'tool_use') blocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
    else if (block.type === 'thinking' || block.type === 'redacted_thinking') blocks.push({ type: block.type, raw: block });
  }
  return {
    stopReason: toStopReason(message.stop_reason),
    blocks,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    },
  };
}

/** Por classe do SDK (mais específica primeiro), nunca pelo texto da mensagem. */
function reasonOf(error: unknown, signal: AbortSignal): AssistantUnavailableReason | null {
  if (signal.aborted || error instanceof Anthropic.APIUserAbortError) return 'timeout';
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (error instanceof Anthropic.APIConnectionError) return 'rede';
  if (error instanceof Anthropic.RateLimitError) return 'limite';
  if (error instanceof Anthropic.AuthenticationError) return 'configuracao';
  if (error instanceof Anthropic.PermissionDeniedError) return 'configuracao';
  if (error instanceof Anthropic.BadRequestError) return 'configuracao';
  if (error instanceof Anthropic.InternalServerError) return 'servico';
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    if (status === 429) return 'limite';
    if (status !== undefined && status >= 400 && status < 500) return 'configuracao';
    return 'servico';
  }
  return null;
}

export function createAnthropicAssistantModel(opts: { apiKey: string; model: string; client?: Anthropic }): AssistantModel {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });

  return {
    async step({ system, messages, tools, signal }) {
      if (messages.at(-1)?.role === 'assistant') {
        throw new Error('A última mensagem não pode ser do assistente (prefill não é suportado)');
      }
      if (signal.aborted) throw new AssistantUnavailableError('timeout');
      try {
        const response = await client.messages.create(
          {
            model: opts.model,
            max_tokens: MAX_TOKENS,
            output_config: { effort: 'low' },
            system: system.map((b) => ({
              type: 'text' as const,
              text: b.text,
              ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
            })),
            tools: tools.map(toTool),
            tool_choice: { type: 'auto' },
            messages: toMessages(messages),
          },
          { signal, timeout: CALL_TIMEOUT_MS, maxRetries: MAX_RETRIES },
        );
        return toStep(response);
      } catch (error) {
        const reason = reasonOf(error, signal);
        if (reason === null) throw error;
        // Mensagem fixa: nada do SDK (pode conter trechos da requisição) nem do usuário.
        throw new AssistantUnavailableError(reason);
      }
    },
  };
}
