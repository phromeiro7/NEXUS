import type { AssistantReplyDto, TaskDto } from '@aj/shared';
import {
  AssistantUnavailableError,
  EventInProgressError,
  InvalidInputError,
  MessageTooLongError,
  RateLimitedError,
  TargetTasksGoneError,
} from '../errors.js';
import type {
  AssistantModel,
  ChatChannel,
  ChatRepository,
  ChatRole,
  Clock,
  ContentBlock,
  InboundEventRepository,
  ModelMessage,
  ModelStep,
  ProfileRepository,
} from '../ports.js';
import { buildContextBlock, buildSystemBlocks } from './prompt.js';
import { ASSISTANT_TOOLS, type makeToolExecutor, type ToolContext } from './tools.js';

const HOUR_MS = 60 * 60 * 1000;
const RETRY_AFTER_SECONDS = 60;

const FALLBACK_REPLY = 'Não consegui gerar uma resposta. Tente de novo.';
const REFUSAL_REPLY = 'Não posso ajudar com isso.';
const MAX_STEPS_REPLY = 'Fiz o que consegui neste pedido. Confira abaixo e envie de novo o que faltou.';

type LogFields = Record<string, string | number | boolean | null>;
export type AssistantLogger = {
  info(event: string, fields: LogFields): void;
  error(event: string, fields: LogFields): void;
};

export type ProcessMessageDeps = {
  model: AssistantModel;
  executor: ReturnType<typeof makeToolExecutor>;
  chat: ChatRepository;
  events: InboundEventRepository;
  profiles: ProfileRepository;
  clock: Clock;
  /** Tarefas vivas do usuário entre `ids` (as de outro usuário ou apagadas não voltam). */
  tasksByIds?: (userId: string, ids: string[]) => Promise<TaskDto[]>;
  logger?: AssistantLogger;
  limits?: { maxChars?: number; perHour?: number; maxSteps?: number; budgetMs?: number; contextMessages?: number };
};

export type ProcessMessageInput = {
  userId: string;
  channel: ChatChannel;
  externalId: string;
  text: string;
  source: 'painel' | 'telegram';
  targetTaskIds?: string[];
};

/** Erro do adaptador que NÃO é indisponibilidade (erro de programação): volta ao chamador como está. */
class Passthrough {
  constructor(readonly cause: unknown) {}
}

function isStoredReply(value: unknown): value is AssistantReplyDto {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.reply === 'string' && Array.isArray(v.affectedTasks);
}

/** Histórico como texto simples: sem mensagens vazias e sem assistente na frente (a API exige `user` primeiro). */
function toModelMessages(history: Array<{ role: ChatRole; content: string }>): ModelMessage[] {
  const messages: ModelMessage[] = history
    .filter((m) => m.content.trim() !== '')
    .map((m) => ({ role: m.role, content: m.content }));  while (messages[0]?.role === 'assistant') messages.shift();
  return messages;
}

function describeTargets(tasks: TaskDto[]): string {
  const lines = tasks.map(
    (t) =>
      `- id ${t.id} | título: ${t.title} | data: ${t.dueDate ?? 'sem data'} | hora: ${t.dueTime ?? 'sem hora'} | ` +
      `tipo: ${t.type} | status: ${t.status}`,
  );
  return ['Tarefa(s)-alvo da resposta do usuário (ids válidos neste pedido):', ...lines].join('\n');
}

function replyText(step: ModelStep): string {
  const text = step.blocks
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
  return text === '' ? FALLBACK_REPLY : text;
}

export function makeProcessMessage(deps: ProcessMessageDeps) {
  const limits = {
    maxChars: deps.limits?.maxChars ?? 1000,
    perHour: deps.limits?.perHour ?? 30,
    maxSteps: deps.limits?.maxSteps ?? 4,
    budgetMs: deps.limits?.budgetMs ?? 20_000,
    contextMessages: deps.limits?.contextMessages ?? 12,
  };
  // Só nomes de eventos, ids, contagens e códigos: nunca texto do usuário, de tarefas ou da resposta.
  const info = (event: string, fields: LogFields) => deps.logger?.info(event, fields);
  const logError = (event: string, fields: LogFields) => deps.logger?.error(event, fields);

  /** Ciclo de ferramentas. Devolve o texto final; lança `AssistantUnavailableError` ou `Passthrough`. */
  async function runCycle(args: {
    userId: string;
    source: 'painel' | 'telegram';
    messages: ModelMessage[];
    ctx: ToolContext;
    start: number;
  }): Promise<string> {
    const { userId, messages, ctx, start } = args;
    for (let step = 1; step <= limits.maxSteps; step += 1) {
      const t0 = deps.clock.now().getTime();
      const remaining = limits.budgetMs - (t0 - start);
      if (t0 - start > limits.budgetMs) throw new AssistantUnavailableError('timeout');
      let result: ModelStep;
      try {
        result = await deps.model.step({
          system: buildSystemBlocks(),
          messages: [...messages],
          tools: ASSISTANT_TOOLS,
          signal: AbortSignal.timeout(Math.max(1, remaining)),
        });
      } catch (error) {
        if (error instanceof AssistantUnavailableError) throw error;
        throw new Passthrough(error);
      }
      info('assistant.step', {
        step,
        stopReason: result.stopReason,
        ms: deps.clock.now().getTime() - t0,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
      if (result.stopReason === 'end_turn') return replyText(result);
      if (result.stopReason === 'refusal') return REFUSAL_REPLY;
      if (result.stopReason === 'max_tokens') throw new AssistantUnavailableError('servico');

      const uses = result.blocks.filter((b) => b.type === 'tool_use');
      if (uses.length === 0) throw new AssistantUnavailableError('servico');
      // O turno do assistente volta EXATAMENTE como veio (thinking, texto e tool_use, na mesma ordem).
      messages.push({ role: 'assistant', content: result.blocks as ContentBlock[] });
      const results: ContentBlock[] = [];
      for (const use of uses) {
        try {
          const r = await deps.executor(userId, use.name, use.input, ctx);
          results.push({ type: 'tool_result', tool_use_id: use.id, content: r.content, is_error: r.isError });
        } catch {
          throw new AssistantUnavailableError('servico');
        }
      }
      messages.push({ role: 'user', content: results });
    }
    return MAX_STEPS_REPLY;
  }

  async function loadTargets(input: ProcessMessageInput): Promise<TaskDto[]> {
    const ids = [...new Set(input.targetTaskIds ?? [])];
    if (ids.length === 0 || !deps.tasksByIds) return [];
    const wanted = new Set(ids);
    const alive = (await deps.tasksByIds(input.userId, ids)).filter((t) => wanted.has(t.id));
    if (alive.length === 0) throw new TargetTasksGoneError();
    return alive;
  }

  return async function processMessage(input: ProcessMessageInput): Promise<AssistantReplyDto> {
    const { userId, channel, externalId } = input;
    const text = input.text.trim();
    if (text === '') throw new InvalidInputError('mensagem_vazia');
    if (text.length > limits.maxChars) throw new MessageTooLongError(limits.maxChars);

    const now = deps.clock.now();
    const start = now.getTime();
    const { timezone } = await deps.profiles.get(userId);

    const registered = await deps.events.register(userId, channel, externalId, now);
    if (!registered.firstTime) {
      if (registered.status === 'processado' && isStoredReply(registered.reply)) {
        info('assistant.replayed', { channel });
        return registered.reply;
      }
      // 'recebido'/'processando': evento concorrente ou preso por uma queda (recuperação é do Plano 5).
      throw new EventInProgressError();
    }

    const ctx: ToolContext = { source: input.source, affected: new Map(), knownIds: new Set() };
    let begun = false;
    try {
      const used = await deps.events.countSince(userId, channel, new Date(start - HOUR_MS));
      if (used >= limits.perHour) throw new RateLimitedError(RETRY_AFTER_SECONDS);

      const messages = toModelMessages(await deps.chat.recent(userId, channel, limits.contextMessages, now));
      const targets = await loadTargets(input);
      for (const t of targets) ctx.knownIds.add(t.id);
      const parts = [buildContextBlock(now, timezone)];
      if (targets.length > 0) parts.push(describeTargets(targets));
      parts.push(text);
      messages.push({ role: 'user', content: parts.join('\n\n') });

      await deps.events.beginModelCall(userId, channel, externalId, now);
      begun = true;
      info('assistant.start', { channel, historyMessages: messages.length - 1, targets: targets.length });

      const replyTextFinal = await runCycle({ userId, source: input.source, messages, ctx, start });
      const reply: AssistantReplyDto = { reply: replyTextFinal, affectedTasks: [...ctx.affected.values()] };

      // A conversa só é guardada quando o pedido termina: reenviar um pedido que falhou não duplica a mensagem.
      await deps.chat.append(userId, channel, 'user', text, now);
      await deps.chat.append(userId, channel, 'assistant', reply.reply, new Date(start + 1));
      await deps.events.markProcessed(userId, channel, externalId, reply, now);
      info('assistant.done', { affected: reply.affectedTasks.length, ms: deps.clock.now().getTime() - start });
      return reply;
    } catch (error) {
      const original = error instanceof Passthrough ? error.cause : error;
      const reason = error instanceof AssistantUnavailableError ? error.reason : 'servico';
      logError('assistant.failed', {
        begun,
        affected: ctx.affected.size,
        errorName: original instanceof Error ? original.name : 'desconhecido',
        reason: begun ? reason : null,
        ms: deps.clock.now().getTime() - start,
      });
      try {
        await deps.events.markFailed(userId, channel, externalId, now);
      } catch (markError) {
        logError('assistant.mark_failed_error', { errorName: markError instanceof Error ? markError.name : 'desconhecido' });
      }
      if (!begun || error instanceof Passthrough) throw original;
      throw new AssistantUnavailableError(reason, [...ctx.affected.values()]);
    }
  };
}
