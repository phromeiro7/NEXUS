import type { AssistantReplyDto, TaskDto } from '@nexus/shared';
import {
  AssistantUnavailableError,
  type AssistantUnavailableReason,
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
/** Sugestão de espera devolvida quando o limite por hora é atingido. */
const RETRY_AFTER_SECONDS = 60;

/** Padrões de `ProcessMessageDeps.limits`. */
const DEFAULT_MAX_CHARS = 1000;
const DEFAULT_MAX_MESSAGES_PER_HOUR = 30;
const DEFAULT_MAX_MODEL_STEPS = 4;
const DEFAULT_BUDGET_MS = 20_000;
const DEFAULT_CONTEXT_MESSAGES = 12;

const FALLBACK_REPLY = 'Não consegui gerar uma resposta. Tente de novo.';
const REFUSAL_REPLY = 'Não posso ajudar com isso.';
const MAX_STEPS_REPLY = 'Fiz o que consegui neste pedido. Confira abaixo e envie de novo o que faltou.';

type LogFields = Record<string, string | number | boolean | null>;
/** Logger estruturado do assistente: só nomes de evento e campos sem texto do usuário. */
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
  limits?: { maxChars?: number; maxMessagesPerHour?: number; maxSteps?: number; budgetMs?: number; contextMessages?: number };
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

/** A resposta gravada no evento tem o formato esperado? (vem do banco como JSON sem tipo). */
function isStoredReply(value: unknown): value is AssistantReplyDto {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.reply === 'string' && Array.isArray(candidate.affectedTasks);
}

/** Histórico como texto simples: sem mensagens vazias e sem assistente na frente (a API exige `user` primeiro). */
function toModelMessages(history: Array<{ role: ChatRole; content: string }>): ModelMessage[] {
  const messages: ModelMessage[] = history
    .filter((message) => message.content.trim() !== '')
    .map((message) => ({ role: message.role, content: message.content }));
  while (messages[0]?.role === 'assistant') messages.shift();
  return messages;
}

/** Bloco que apresenta ao modelo as tarefas-alvo de uma resposta (reply) do usuário. */
function describeTargetTasks(tasks: TaskDto[]): string {
  const lines = tasks.map(
    (task) =>
      `- id ${task.id} | título: ${task.title} | data: ${task.dueDate ?? 'sem data'} | hora: ${task.dueTime ?? 'sem hora'} | ` +
      `tipo: ${task.type} | status: ${task.status}`,
  );
  return ['Tarefa(s)-alvo da resposta do usuário (ids válidos neste pedido):', ...lines].join('\n');
}

const errorNameOf = (error: unknown) => (error instanceof Error ? error.name : 'desconhecido');

/** Motivo da indisponibilidade, em texto para o usuário. */
const UNAVAILABLE_REASON_TEXT: Record<AssistantUnavailableReason, string> = {
  timeout: 'o tempo esgotou',
  rede: 'houve falha de conexão com o assistente',
  limite: 'o assistente atingiu um limite de uso',
  configuracao: 'o assistente não está configurado',
  servico: 'o assistente ficou indisponível',
};

/** Resposta terminal verdadeira quando o pedido falhou DEPOIS de gravar: só o que de fato foi gravado. */
function partialReplyText(reason: AssistantUnavailableReason, completedTasks: TaskDto[]): string {
  const lines = completedTasks.map((task) => {
    // `dueDate` é YYYY-MM-DD: mostra DD/MM.
    const when =
      task.dueDate === null
        ? 'sem data'
        : `${task.dueDate.slice(8, 10)}/${task.dueDate.slice(5, 7)}${task.dueTime === null ? '' : ` ${task.dueTime}`}`;
    return `- ${task.title} (${when})${task.status === 'concluida' ? ' [concluída]' : ''}`;
  });
  return [`Não consegui concluir tudo (${UNAVAILABLE_REASON_TEXT[reason]}). Já fiz:`, ...lines, 'Envie de novo só o que faltou.'].join('\n');
}

/** Junta os blocos de texto do passo final; vazio vira a resposta padrão. */
function extractReplyText(step: ModelStep): string {
  const text = step.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();
  return text === '' ? FALLBACK_REPLY : text;
}

/**
 * Cria o caso de uso que processa uma mensagem do usuário com o assistente de IA: valida, aplica o limite
 * por hora, garante idempotência pelo `externalId` (reenvio reproduz a resposta gravada) e roda o ciclo de
 * ferramentas dentro de um orçamento de tempo. Se algo falhar depois de gravar tarefas, a resposta diz só o
 * que de fato foi feito.
 */
export function makeProcessMessage(deps: ProcessMessageDeps) {
  const limits = {
    maxChars: deps.limits?.maxChars ?? DEFAULT_MAX_CHARS,
    maxMessagesPerHour: deps.limits?.maxMessagesPerHour ?? DEFAULT_MAX_MESSAGES_PER_HOUR,
    maxSteps: deps.limits?.maxSteps ?? DEFAULT_MAX_MODEL_STEPS,
    budgetMs: deps.limits?.budgetMs ?? DEFAULT_BUDGET_MS,
    contextMessages: deps.limits?.contextMessages ?? DEFAULT_CONTEXT_MESSAGES,
  };
  // Só nomes de eventos, ids, contagens e códigos: nunca texto do usuário, de tarefas ou da resposta.
  const logInfo = (event: string, fields: LogFields) => deps.logger?.info(event, fields);
  const logError = (event: string, fields: LogFields) => deps.logger?.error(event, fields);

  /** Ciclo de ferramentas. Devolve o texto final; lança `AssistantUnavailableError` ou `Passthrough`. */
  async function runToolLoop(args: {
    userId: string;
    source: 'painel' | 'telegram';
    messages: ModelMessage[];
    toolContext: ToolContext;
    startedAt: number;
  }): Promise<string> {
    const { userId, messages, toolContext, startedAt } = args;
    for (let stepNumber = 1; stepNumber <= limits.maxSteps; stepNumber += 1) {
      const stepStartedAt = deps.clock.now().getTime();
      const elapsedMs = stepStartedAt - startedAt;
      const remainingBudgetMs = limits.budgetMs - elapsedMs;
      if (elapsedMs > limits.budgetMs) throw new AssistantUnavailableError('timeout');
      let modelStep: ModelStep;
      try {
        modelStep = await deps.model.step({
          system: buildSystemBlocks(),
          messages: [...messages],
          tools: ASSISTANT_TOOLS,
          signal: AbortSignal.timeout(Math.max(1, remainingBudgetMs)),
        });
      } catch (error) {
        if (error instanceof AssistantUnavailableError) throw error;
        throw new Passthrough(error);
      }
      logInfo('assistant.step', {
        step: stepNumber,
        stopReason: modelStep.stopReason,
        ms: deps.clock.now().getTime() - stepStartedAt,
        inputTokens: modelStep.usage.inputTokens,
        outputTokens: modelStep.usage.outputTokens,
      });
      if (modelStep.stopReason === 'end_turn') return extractReplyText(modelStep);
      if (modelStep.stopReason === 'refusal') return REFUSAL_REPLY;
      if (modelStep.stopReason === 'max_tokens') throw new AssistantUnavailableError('servico');

      const toolUses = modelStep.blocks.filter((block) => block.type === 'tool_use');
      if (toolUses.length === 0) throw new AssistantUnavailableError('servico');
      // O turno do assistente volta EXATAMENTE como veio (thinking, texto e tool_use, na mesma ordem).
      messages.push({ role: 'assistant', content: modelStep.blocks as ContentBlock[] });
      const toolResults: ContentBlock[] = [];
      for (const toolUse of toolUses) {
        try {
          const toolResult = await deps.executor(userId, toolUse.name, toolUse.input, toolContext);
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: toolResult.content, is_error: toolResult.isError });
        } catch {
          throw new AssistantUnavailableError('servico');
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }
    return MAX_STEPS_REPLY;
  }

  /** Tarefas-alvo ainda vivas. Se todas sumiram, o pedido não faz mais sentido: `TargetTasksGoneError`. */
  async function loadTargetTasks(input: ProcessMessageInput): Promise<TaskDto[]> {
    const ids = [...new Set(input.targetTaskIds ?? [])];
    if (ids.length === 0 || !deps.tasksByIds) return [];
    const requestedIds = new Set(ids);
    const alive = (await deps.tasksByIds(input.userId, ids)).filter((task) => requestedIds.has(task.id));
    if (alive.length === 0) throw new TargetTasksGoneError();
    return alive;
  }

  return async function processMessage(input: ProcessMessageInput): Promise<AssistantReplyDto> {
    const { userId, channel, externalId } = input;
    const text = input.text.trim();
    if (text === '') throw new InvalidInputError('mensagem_vazia');
    if (text.length > limits.maxChars) throw new MessageTooLongError(limits.maxChars);

    const now = deps.clock.now();
    const startedAt = now.getTime();
    const { timezone } = await deps.profiles.get(userId);

    // Idempotência: o mesmo `externalId` nunca chama o modelo duas vezes; já processado = reproduz a resposta.
    const registration = await deps.events.register(userId, channel, externalId, now);
    if (!registration.firstTime) {
      if (registration.status === 'processado' && isStoredReply(registration.reply)) {
        logInfo('assistant.replayed', { channel });
        return registration.reply;
      }
      // 'recebido'/'processando': evento concorrente ou preso por uma queda (recuperação é do Plano 5).
      throw new EventInProgressError();
    }

    const toolContext: ToolContext = { source: input.source, affectedTasks: new Map(), knownIds: new Set() };
    let modelCallStarted = false;
    try {
      // Limite por hora: conta os eventos do usuário registrados na última hora.
      const eventsInLastHour = await deps.events.countSince(userId, new Date(startedAt - HOUR_MS));
      if (eventsInLastHour >= limits.maxMessagesPerHour) throw new RateLimitedError(RETRY_AFTER_SECONDS);

      const messages = toModelMessages(await deps.chat.recent(userId, channel, limits.contextMessages, now));
      const targetTasks = await loadTargetTasks(input);
      for (const task of targetTasks) toolContext.knownIds.add(task.id);
      const userMessageParts = [buildContextBlock(now, timezone)];
      if (targetTasks.length > 0) userMessageParts.push(describeTargetTasks(targetTasks));
      userMessageParts.push(text);
      messages.push({ role: 'user', content: userMessageParts.join('\n\n') });

      await deps.events.beginModelCall(userId, channel, externalId, now);
      modelCallStarted = true;
      logInfo('assistant.start', { channel, historyMessages: messages.length - 1, targets: targetTasks.length });

      const finalReplyText = await runToolLoop({ userId, source: input.source, messages, toolContext, startedAt });
      const reply: AssistantReplyDto = { reply: finalReplyText, affectedTasks: [...toolContext.affectedTasks.values()] };

      await finish(reply);
      logInfo('assistant.done', { affected: reply.affectedTasks.length, ms: deps.clock.now().getTime() - startedAt });
      return reply;
    } catch (error) {
      const originalError = error instanceof Passthrough ? error.cause : error;
      const reason = error instanceof AssistantUnavailableError ? error.reason : 'servico';
      logError('assistant.failed', {
        begun: modelCallStarted,
        affected: toolContext.affectedTasks.size,
        errorName: errorNameOf(originalError),
        reason: modelCallStarted ? reason : null,
        ms: deps.clock.now().getTime() - startedAt,
      });
      if (toolContext.affectedTasks.size > 0) {
        // Já houve escrita: o evento termina com uma resposta verdadeira (reenviar a reproduz, sem recriar nada).
        const affectedTasks = [...toolContext.affectedTasks.values()];
        const reply = { reply: partialReplyText(reason, affectedTasks), affectedTasks };
        await finish(reply);
        return reply;
      }
      await failEvent();
      if (!modelCallStarted || error instanceof Passthrough) throw originalError;
      throw new AssistantUnavailableError(reason, []);
    }

    /** Fecha o evento sem nunca mascarar a resposta: falhas daqui só são registradas (nomes, sem texto). */
    async function finish(reply: AssistantReplyDto): Promise<void> {
      try {
        await deps.chat.append(userId, channel, 'user', text, now);
        // +1 ms: a resposta fica sempre depois da pergunta na ordem do histórico.
        await deps.chat.append(userId, channel, 'assistant', reply.reply, new Date(startedAt + 1));
      } catch (error) {
        logError('assistant.chat_append_error', { errorName: errorNameOf(error) });
      }
      try {
        await deps.events.markProcessed(userId, channel, externalId, reply, now);
      } catch (error) {
        logError('assistant.mark_processed_error', { errorName: errorNameOf(error) });
        // Sem escrita nenhuma, reabrir o evento é seguro; com escrita ele fica 'processando' (nunca 'falhou').
        if (reply.affectedTasks.length === 0) await failEvent();
      }
    }

    /** Marca o evento como falho (o usuário pode reenviar); falha aqui só é registrada. */
    async function failEvent(): Promise<void> {
      try {
        await deps.events.markFailed(userId, channel, externalId, now);
      } catch (error) {
        logError('assistant.mark_failed_error', { errorName: errorNameOf(error) });
      }
    }
  };
}
