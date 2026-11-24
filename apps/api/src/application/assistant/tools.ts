import {
  isoDateSchema,
  TASK_TITLE_MAX,
  taskStatusSchema,
  taskTypeSchema,
  timeOfDaySchema,
  todayIn,
  type CreateTaskInput,
  type TaskDto,
  type UpdateTaskInput,
} from '@nexus/shared';
import { z } from 'zod';
import { InvalidLocalTimeError } from '../../domain/reminders.js';
import { InvalidTransitionError } from '../../domain/task-status.js';
import { ValidationError } from '../../http-errors.js';
import { ConflictError, InvalidInputError, NotFoundError } from '../errors.js';
import type { Clock, ProfileRepository, ToolDefinition } from '../ports.js';
import type { makeTaskUseCases } from '../tasks.js';

/** `listar_tarefas` devolve no máximo isto; o restante só é contado (`maisResultados`). */
const MAX_LISTED_TASKS = 50;
const MAX_TITLE_QUERY_LENGTH = 100;

const titleSchema = z.string().trim().min(1).max(TASK_TITLE_MAX);

const createTaskArgsSchema = z
  .object({
    title: titleSchema,
    type: taskTypeSchema.optional(),
    dueDate: isoDateSchema.optional(),
    dueTime: timeOfDaySchema.optional(),
    fatal: z.boolean().optional(),
  })
  .strict()
  .refine((args) => args.dueTime === undefined || args.dueDate !== undefined, {
    message: 'dueTime requires dueDate',
    path: ['dueTime'],
  });

const listTasksArgsSchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    status: z.array(taskStatusSchema).optional(),
    withoutDate: z.boolean().optional(),
    query: z.string().max(MAX_TITLE_QUERY_LENGTH).optional(),
  })
  .strict()
  .refine((args) => args.from === undefined || args.to === undefined || args.from <= args.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });

const updateTaskArgsSchema = z
  .object({
    id: z.uuid(),
    title: titleSchema.optional(),
    type: taskTypeSchema.optional(),
    dueDate: isoDateSchema.nullable().optional(),
    dueTime: timeOfDaySchema.nullable().optional(),
    fatal: z.boolean().optional(),
    status: taskStatusSchema.optional(),
  })
  .strict()
  .refine((args) => Object.entries(args).some(([key, value]) => key !== 'id' && value !== undefined), {
    message: 'at least one field besides id is required',
    path: ['campos'],
  });

const completeTaskArgsSchema = z.object({ id: z.uuid() }).strict();

/** Nome da ferramenta (como o modelo a chama) -> validação dos argumentos. */
const TOOL_ARGUMENT_SCHEMAS = {
  criar_tarefa: createTaskArgsSchema,
  listar_tarefas: listTasksArgsSchema,
  alterar_tarefa: updateTaskArgsSchema,
  concluir_tarefa: completeTaskArgsSchema,
} as const;
type ToolName = keyof typeof TOOL_ARGUMENT_SCHEMAS;

/** JSON Schema do zod sem o campo `$schema`, no formato que a definição de ferramenta espera. */
function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

const DATE_TIME_FORMAT_HINT = 'Datas sempre em YYYY-MM-DD e horas sempre em HH:mm (24 h).';
const TASK_ID_HINT = 'O id deve vir de um resultado de listar_tarefas desta conversa; nunca invente um id.';

/** Ferramentas oferecidas ao modelo; as descrições orientam QUANDO usar cada uma. */
export const ASSISTANT_TOOLS: ToolDefinition[] = [
  {
    name: 'criar_tarefa',
    description:
      'Use quando o usuário pedir para registrar uma nova tarefa. ' +
      `${DATE_TIME_FORMAT_HINT} Só informe dueTime junto com dueDate. ` +
      'Se a ferramenta devolver erro de data ou horário no passado, pergunte ao usuário em vez de escolher outra data.',
    inputSchema: jsonSchemaOf(createTaskArgsSchema),
  },
  {
    name: 'listar_tarefas',
    description:
      'Use para consultar as tarefas do usuário (por período, status, sem data ou por trecho do título) ' +
      `e SEMPRE antes de alterar ou concluir uma tarefa, para obter o id. ${DATE_TIME_FORMAT_HINT} ` +
      `Devolve no máximo ${MAX_LISTED_TASKS} tarefas e informa quantas ficaram de fora.`,
    inputSchema: jsonSchemaOf(listTasksArgsSchema),
  },
  {
    name: 'alterar_tarefa',
    description:
      'Use para mudar título, tipo, data, hora, urgência (fatal) ou status de uma tarefa existente. ' +
      `${TASK_ID_HINT} ${DATE_TIME_FORMAT_HINT} Use null em dueDate ou dueTime para remover. Para marcar como feita prefira concluir_tarefa.`,
    inputSchema: jsonSchemaOf(updateTaskArgsSchema),
  },
  {
    name: 'concluir_tarefa',
    description:
      'Use quando o usuário disser que uma tarefa foi feita ou cumprida. ' + TASK_ID_HINT,
    inputSchema: jsonSchemaOf(completeTaskArgsSchema),
  },
];

/**
 * Estado de um pedido ao assistente: `affectedTasks` são as tarefas gravadas (o recibo da resposta) e `knownIds`
 * os ids que o modelo pode usar, porque vieram de uma ferramenta ou do alvo da resposta (nunca inventados).
 */
export type ToolContext = {
  source: 'painel' | 'telegram';
  affectedTasks: Map<string, TaskDto>;
  knownIds: Set<string>;
};
export type ToolResult = { content: string; isError: boolean };

const errorResult = (content: string): ToolResult => ({ content, isError: true });
const successResult = (value: unknown): ToolResult => ({ content: JSON.stringify(value), isError: false });

const PAST_DATE_ERROR =
  'data_no_passado: essa data já passou; pergunte ao usuário qual data usar, não escolha outra sozinho';
const PAST_TIME_ERROR =
  'horario_no_passado: esse horário de hoje já passou; pergunte ao usuário qual horário ou data usar, não escolha outro sozinho';

const UNKNOWN_ID_ERROR = 'id_desconhecido: liste as tarefas primeiro';

/** Só os campos que o modelo precisa (menos tokens). */
function toCompactTask(task: TaskDto) {
  return { id: task.id, title: task.title, type: task.type, status: task.status, dueDate: task.dueDate, dueTime: task.dueTime, fatal: task.fatal };
}

/** Só o caminho do campo; nunca o valor enviado. */
function invalidArgument(error: z.ZodError): ToolResult {
  const issue = error.issues[0];
  let field = '';
  if (issue) {
    field = issue.path.map(String).join('.');
    if (field === '' && issue.code === 'unrecognized_keys') field = issue.keys.join(', ');
  }
  return errorResult(field === '' ? 'argumento inválido' : `argumento inválido: ${field}`);
}

/** "HH:mm" (24 h) no fuso dado, comparável como texto com `dueTime`. */
function localTimeOfDay(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}

/**
 * Executor das ferramentas: valida os argumentos, aplica as regras (sem datas no passado, só ids conhecidos)
 * e devolve erros como texto para o modelo corrigir. Erro inesperado é relançado.
 */
export function makeToolExecutor(deps: {
  tasks: ReturnType<typeof makeTaskUseCases>;
  profiles: ProfileRepository;
  clock: Clock;
}) {
  /** Regra determinística do passado, no fuso do usuário. `null` = pode seguir. */
  async function checkNotInPast(userId: string, date: string | null | undefined, time: string | null | undefined) {
    if (date === null || date === undefined) return null;
    const { timezone } = await deps.profiles.get(userId);
    const now = deps.clock.now();
    const today = todayIn(timezone, now);
    if (date < today) return errorResult(PAST_DATE_ERROR);
    if (date === today && time !== null && time !== undefined && time < localTimeOfDay(timezone, now)) return errorResult(PAST_TIME_ERROR);
    return null;
  }

  /** Guarda a tarefa gravada no recibo do pedido e libera o id para as próximas ferramentas. */
  function recordAffectedTask(context: ToolContext, task: TaskDto): ToolResult {
    context.affectedTasks.set(task.id, task);
    context.knownIds.add(task.id);
    return successResult(toCompactTask(task));
  }

  async function runTool(userId: string, name: ToolName, input: unknown, context: ToolContext): Promise<ToolResult> {
    switch (name) {
      case 'criar_tarefa': {
        const args = input as z.infer<typeof createTaskArgsSchema>;
        const pastError = await checkNotInPast(userId, args.dueDate, args.dueTime);
        if (pastError) return pastError;
        const createInput: CreateTaskInput = {
          title: args.title,
          fatal: args.fatal ?? false,
          ...(args.type !== undefined ? { type: args.type } : {}),
          ...(args.dueDate !== undefined ? { dueDate: args.dueDate } : {}),
          ...(args.dueTime !== undefined ? { dueTime: args.dueTime } : {}),
        };
        return recordAffectedTask(context, await deps.tasks.create(userId, createInput, context.source));
      }
      case 'listar_tarefas': {
        const args = input as z.infer<typeof listTasksArgsSchema>;
        const listed = await deps.tasks.list(userId, {
          ...(args.from !== undefined ? { from: args.from } : {}),
          ...(args.to !== undefined ? { to: args.to } : {}),
          ...(args.status !== undefined ? { status: args.status } : {}),
          ...(args.withoutDate !== undefined ? { withoutDate: args.withoutDate } : {}),
        });
        const titleQuery = args.query?.toLowerCase();
        const matching =
          titleQuery === undefined ? listed : listed.filter((task) => task.title.toLowerCase().includes(titleQuery));
        const shown = matching.slice(0, MAX_LISTED_TASKS);
        for (const task of shown) context.knownIds.add(task.id);
        const hiddenCount = matching.length - shown.length;
        return successResult({ items: shown.map(toCompactTask), ...(hiddenCount > 0 ? { maisResultados: hiddenCount } : {}) });
      }
      case 'alterar_tarefa': {
        const { id, ...fields } = input as z.infer<typeof updateTaskArgsSchema>;
        if (!context.knownIds.has(id)) return errorResult(UNKNOWN_ID_ERROR);
        const patch = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as UpdateTaskInput;
        // Só quando o patch mexe em data/hora: a regra vale para o estado mesclado (patch sobre o gravado).
        if (patch.dueDate !== undefined || patch.dueTime !== undefined) {
          const current = await deps.tasks.get(userId, id);
          const date = patch.dueDate !== undefined ? patch.dueDate : current.dueDate;
          const time = patch.dueTime !== undefined ? patch.dueTime : current.dueTime;
          const pastError = await checkNotInPast(userId, date, time);
          if (pastError) return pastError;
        }
        return recordAffectedTask(context, await deps.tasks.update(userId, id, patch));
      }
      case 'concluir_tarefa': {
        const { id } = input as z.infer<typeof completeTaskArgsSchema>;
        if (!context.knownIds.has(id)) return errorResult(UNKNOWN_ID_ERROR);
        return recordAffectedTask(context, await deps.tasks.update(userId, id, { status: 'concluida' }));
      }
    }
  }

  return async (userId: string, name: string, rawInput: unknown, context: ToolContext): Promise<ToolResult> => {
    // `hasOwn` evita aceitar nomes herdados do protótipo (ex.: "constructor") vindos do modelo.
    if (!Object.hasOwn(TOOL_ARGUMENT_SCHEMAS, name)) return errorResult('ferramenta desconhecida');
    const toolName = name as ToolName;
    const parsed = TOOL_ARGUMENT_SCHEMAS[toolName].safeParse(rawInput);
    if (!parsed.success) return invalidArgument(parsed.error);
    try {
      return await runTool(userId, toolName, parsed.data, context);
    } catch (error) {
      // Erros de regra de negócio voltam ao modelo como texto curto, para ele explicar ou corrigir.
      if (error instanceof NotFoundError) return errorResult('tarefa não encontrada');
      if (error instanceof InvalidTransitionError) return errorResult('mudança de status não permitida');
      if (error instanceof ConflictError && error.code === 'tarefa_encerrada') return errorResult('tarefa já encerrada');
      if (error instanceof InvalidLocalTimeError) {
        return errorResult('essa hora não existe/é ambígua neste fuso (horário de verão)');
      }
      if (error instanceof InvalidInputError) return errorResult('argumento inválido: dueTime');
      if (error instanceof ValidationError) return errorResult('argumento inválido');
      throw error;
    }
  };
}
