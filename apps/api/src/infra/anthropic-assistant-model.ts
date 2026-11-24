import Anthropic from '@anthropic-ai/sdk';
import { AssistantUnavailableError, type AssistantUnavailableReason } from '../application/errors.js';
import type { AssistantModel, ContentBlock, ModelMessage, ModelStep, ToolDefinition } from '../application/ports.js';

const MAX_TOKENS = 4096;
/** Cada passo precisa caber no orçamento da requisição do usuário; acima disso vira 'timeout'. */
const CALL_TIMEOUT_MS = 12_000;
/** Um retry do próprio SDK (só erros transitórios); mais que isso estouraria o orçamento de tempo. */
const MAX_RETRIES = 1;
/** Esforço baixo: as ferramentas são simples e a resposta precisa ser rápida e barata. */
const REASONING_EFFORT = 'low';
const HTTP_TOO_MANY_REQUESTS = 429;

/** Palavras-chave que o modo `strict` não aceita; o Zod continua validando tudo no servidor. */
const STRICT_UNSUPPORTED = new Set(['minLength', 'maxLength', 'minimum', 'maximum', 'pattern']);
/** Trecho do `pattern` de uuid gerado pelo Zod: quando o `pattern` é removido, vira `format: 'uuid'`. */
const UUID_PATTERN_HINT = '[0-9a-fA-F]{8}-';

/** Cópia do JSON Schema sem as palavras-chave não suportadas pelo modo `strict`. */
function sanitizeSchema(node: unknown, insideProperties = false): unknown {
  if (Array.isArray(node)) return node.map((item) => sanitizeSchema(item));
  if (node === null || typeof node !== 'object') return node;
  const source = node as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    // Dentro de `properties` as chaves são nomes de campos, não palavras-chave.
    if (!insideProperties && STRICT_UNSUPPORTED.has(key)) continue;
    sanitized[key] = sanitizeSchema(value, !insideProperties && key === 'properties');
  }
  const isUuidPattern =
    !insideProperties && typeof source.pattern === 'string' && source.pattern.includes(UUID_PATTERN_HINT);
  if (isUuidPattern && sanitized.format === undefined) {
    sanitized.format = 'uuid';
  }
  return sanitized;
}

/** Ferramenta da aplicação -> ferramenta da API, em modo `strict` (a entrada sempre segue o schema). */
function toTool(tool: ToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: sanitizeSchema(tool.inputSchema) as Anthropic.Tool.InputSchema,
    strict: true,
  };
}

/** Bloco de conteúdo da aplicação -> bloco de requisição da API. */
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
  return messages.map((message) => ({
    role: message.role,
    content:
      typeof message.content === 'string'
        ? message.content
        // Bloco de texto vazio dá 400 na API; blocos de pensamento passam intactos.
        : message.content.filter((block) => block.type !== 'text' || block.text !== '').map(toBlockParam),
  }));
}

/** Reduz os motivos de parada da API aos que o laço do assistente trata. */
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

/** Resposta da API -> passo do modelo; blocos de pensamento guardam o original para serem devolvidos intactos. */
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

/**
 * Motivo de indisponibilidade a partir do erro do SDK, ou `null` se não for erro da API (bug nosso: relançado).
 * Por classe do SDK (mais específica primeiro), nunca pelo texto da mensagem.
 */
function unavailableReasonOf(error: unknown, signal: AbortSignal): AssistantUnavailableReason | null {
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
    if (status === HTTP_TOO_MANY_REQUESTS) return 'limite';
    if (status !== undefined && status >= 400 && status < 500) return 'configuracao';
    return 'servico';
  }
  return null;
}

/** `logLevel: 'off'` fixo: ANTHROPIC_LOG=debug no ambiente nunca pode fazer o SDK logar corpos de requisição. */
export function createSdkClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, logLevel: 'off' });
}

/** Modelo do assistente sobre a API da Anthropic; erros da API viram `AssistantUnavailableError` com motivo fixo. */
export function createAnthropicAssistantModel(opts: { apiKey: string; model: string; client?: Anthropic }): AssistantModel {
  const client = opts.client ?? createSdkClient(opts.apiKey);

  return {
    async step({ system, messages, tools, signal }) {
      // A API trataria a última mensagem do assistente como prefill; o laço nunca deve chegar aqui assim.
      if (messages.at(-1)?.role === 'assistant') {
        throw new Error('A última mensagem não pode ser do assistente (prefill não é suportado)');
      }
      if (signal.aborted) throw new AssistantUnavailableError('timeout');
      try {
        const response = await client.messages.create(
          {
            model: opts.model,
            max_tokens: MAX_TOKENS,
            output_config: { effort: REASONING_EFFORT },
            // Blocos marcados com `cache` encerram o prefixo estável do prompt (prompt caching).
            system: system.map((systemBlock) => ({
              type: 'text' as const,
              text: systemBlock.text,
              ...(systemBlock.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
            })),
            tools: tools.map(toTool),
            tool_choice: { type: 'auto' },
            messages: toMessages(messages),
          },
          { signal, timeout: CALL_TIMEOUT_MS, maxRetries: MAX_RETRIES },
        );
        return toStep(response);
      } catch (error) {
        const reason = unavailableReasonOf(error, signal);
        if (reason === null) throw error;
        // Mensagem fixa: nada do SDK (pode conter trechos da requisição) nem do usuário.
        throw new AssistantUnavailableError(reason);
      }
    },
  };
}
