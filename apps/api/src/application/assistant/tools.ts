import {
  isoDateSchema,
  taskStatusSchema,
  taskTypeSchema,
  timeOfDaySchema,
  todayIn,
  type CreateTaskInput,
  type TaskDto,
  type UpdateTaskInput,
} from '@nexus/shared';
import { z } from 'zod';
import { HoraInvalidaError } from '../../domain/reminders.js';
import { InvalidTransitionError } from '../../domain/task-status.js';
import { ValidationError } from '../../http-errors.js';
import { ConflictError, InvalidInputError, NotFoundError } from '../errors.js';
import type { Clock, ProfileRepository, ToolDefinition } from '../ports.js';
import type { makeTaskUseCases } from '../tasks.js';

const MAX_LISTED = 50;

const titleSchema = z.string().trim().min(1).max(200);

const criarTarefaSchema = z
  .object({
    title: titleSchema,
    type: taskTypeSchema.optional(),
    dueDate: isoDateSchema.optional(),
    dueTime: timeOfDaySchema.optional(),
    fatal: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.dueTime === undefined || v.dueDate !== undefined, {
    message: 'dueTime requires dueDate',
    path: ['dueTime'],
  });

const listarTarefasSchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    status: z.array(taskStatusSchema).optional(),
    withoutDate: z.boolean().optional(),
    query: z.string().max(100).optional(),
  })
  .strict()
  .refine((v) => v.from === undefined || v.to === undefined || v.from <= v.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });

const alterarTarefaSchema = z
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
  .refine((v) => Object.entries(v).some(([k, x]) => k !== 'id' && x !== undefined), {
    message: 'at least one field besides id is required',
    path: ['campos'],
  });

const concluirTarefaSchema = z.object({ id: z.uuid() }).strict();

const SCHEMAS = {
  criar_tarefa: criarTarefaSchema,
  listar_tarefas: listarTarefasSchema,
  alterar_tarefa: alterarTarefaSchema,
  concluir_tarefa: concluirTarefaSchema,
} as const;
type ToolName = keyof typeof SCHEMAS;

function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

const FORMATS = 'Datas sempre em YYYY-MM-DD e horas sempre em HH:mm (24 h).';
const IDS = 'O id deve vir de um resultado de listar_tarefas desta conversa; nunca invente um id.';

export const ASSISTANT_TOOLS: ToolDefinition[] = [
  {
    name: 'criar_tarefa',
    description:
      'Use quando o usuário pedir para registrar uma nova tarefa. ' +
      `${FORMATS} Só informe dueTime junto com dueDate. ` +
      'Se a ferramenta devolver erro de data ou horário no passado, pergunte ao usuário em vez de escolher outra data.',
    inputSchema: jsonSchemaOf(criarTarefaSchema),
  },
  {
    name: 'listar_tarefas',
    description:
      'Use para consultar as tarefas do usuário (por período, status, sem data ou por trecho do título) ' +
      `e SEMPRE antes de alterar ou concluir uma tarefa, para obter o id. ${FORMATS} ` +
      'Devolve no máximo 50 tarefas e informa quantas ficaram de fora.',
    inputSchema: jsonSchemaOf(listarTarefasSchema),
  },
  {
    name: 'alterar_tarefa',
    description:
      'Use para mudar título, tipo, data, hora, urgência (fatal) ou status de uma tarefa existente. ' +
      `${IDS} ${FORMATS} Use null em dueDate ou dueTime para remover. Para marcar como feita prefira concluir_tarefa.`,
    inputSchema: jsonSchemaOf(alterarTarefaSchema),
  },
  {
    name: 'concluir_tarefa',
    description:
      'Use quando o usuário disser que uma tarefa foi feita ou cumprida. ' + IDS,
    inputSchema: jsonSchemaOf(concluirTarefaSchema),
  },
];

export type ToolContext = {
  source: 'painel' | 'telegram';
  affected: Map<string, TaskDto>;
  knownIds: Set<string>;
};
export type ToolResult = { content: string; isError: boolean };

const fail = (content: string): ToolResult => ({ content, isError: true });
const ok = (value: unknown): ToolResult => ({ content: JSON.stringify(value), isError: false });

const PAST_DATE =
  'data_no_passado: essa data já passou; pergunte ao usuário qual data usar, não escolha outra sozinho';
const PAST_TIME =
  'horario_no_passado: esse horário de hoje já passou; pergunte ao usuário qual horário ou data usar, não escolha outro sozinho';

function compact(t: TaskDto) {
  return { id: t.id, title: t.title, type: t.type, status: t.status, dueDate: t.dueDate, dueTime: t.dueTime, fatal: t.fatal };
}

/** Só o caminho do campo; nunca o valor enviado. */
function invalidArgument(error: z.ZodError): ToolResult {
  const issue = error.issues[0];
  let field = '';
  if (issue) {
    field = issue.path.map(String).join('.');
    if (field === '' && issue.code === 'unrecognized_keys') field = issue.keys.join(', ');
  }
  return fail(field === '' ? 'argumento inválido' : `argumento inválido: ${field}`);
}

function localTime(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}

export function makeToolExecutor(deps: {
  tasks: ReturnType<typeof makeTaskUseCases>;
  profiles: ProfileRepository;
  clock: Clock;
}) {
  /** Regra determinística do passado, no fuso do usuário. `null` = pode seguir. */
  async function pastError(userId: string, date: string | null | undefined, time: string | null | undefined) {
    if (date === null || date === undefined) return null;
    const { timezone } = await deps.profiles.get(userId);
    const now = deps.clock.now();
    const today = todayIn(timezone, now);
    if (date < today) return fail(PAST_DATE);
    if (date === today && time !== null && time !== undefined && time < localTime(timezone, now)) return fail(PAST_TIME);
    return null;
  }

  function remember(ctx: ToolContext, task: TaskDto): ToolResult {
    ctx.affected.set(task.id, task);
    ctx.knownIds.add(task.id);
    return ok(compact(task));
  }

  async function run(userId: string, name: ToolName, input: unknown, ctx: ToolContext): Promise<ToolResult> {
    switch (name) {
      case 'criar_tarefa': {
        const v = input as z.infer<typeof criarTarefaSchema>;
        const past = await pastError(userId, v.dueDate, v.dueTime);
        if (past) return past;
        const create: CreateTaskInput = {
          title: v.title,
          fatal: v.fatal ?? false,
          ...(v.type !== undefined ? { type: v.type } : {}),
          ...(v.dueDate !== undefined ? { dueDate: v.dueDate } : {}),
          ...(v.dueTime !== undefined ? { dueTime: v.dueTime } : {}),
        };
        return remember(ctx, await deps.tasks.create(userId, create, ctx.source));
      }
      case 'listar_tarefas': {
        const v = input as z.infer<typeof listarTarefasSchema>;
        const listed = await deps.tasks.list(userId, {
          ...(v.from !== undefined ? { from: v.from } : {}),
          ...(v.to !== undefined ? { to: v.to } : {}),
          ...(v.status !== undefined ? { status: v.status } : {}),
          ...(v.withoutDate !== undefined ? { withoutDate: v.withoutDate } : {}),
        });
        const needle = v.query?.toLowerCase();
        const matching = needle === undefined ? listed : listed.filter((t) => t.title.toLowerCase().includes(needle));
        const shown = matching.slice(0, MAX_LISTED);
        for (const t of shown) ctx.knownIds.add(t.id);
        const rest = matching.length - shown.length;
        return ok({ items: shown.map(compact), ...(rest > 0 ? { maisResultados: rest } : {}) });
      }
      case 'alterar_tarefa': {
        const { id, ...fields } = input as z.infer<typeof alterarTarefaSchema>;
        if (!ctx.knownIds.has(id)) return fail('id_desconhecido: liste as tarefas primeiro');
        const patch = Object.fromEntries(Object.entries(fields).filter(([, x]) => x !== undefined)) as UpdateTaskInput;
        // Só quando o patch mexe em data/hora: a regra vale para o estado mesclado (patch sobre o gravado).
        if (patch.dueDate !== undefined || patch.dueTime !== undefined) {
          const current = await deps.tasks.get(userId, id);
          const date = patch.dueDate !== undefined ? patch.dueDate : current.dueDate;
          const time = patch.dueTime !== undefined ? patch.dueTime : current.dueTime;
          const past = await pastError(userId, date, time);
          if (past) return past;
        }
        return remember(ctx, await deps.tasks.update(userId, id, patch));
      }
      case 'concluir_tarefa': {
        const { id } = input as z.infer<typeof concluirTarefaSchema>;
        if (!ctx.knownIds.has(id)) return fail('id_desconhecido: liste as tarefas primeiro');
        return remember(ctx, await deps.tasks.update(userId, id, { status: 'concluida' }));
      }
    }
  }

  return async (userId: string, name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolResult> => {
    if (!Object.hasOwn(SCHEMAS, name)) return fail('ferramenta desconhecida');
    const toolName = name as ToolName;
    const parsed = SCHEMAS[toolName].safeParse(rawInput);
    if (!parsed.success) return invalidArgument(parsed.error);
    try {
      return await run(userId, toolName, parsed.data, ctx);
    } catch (error) {
      if (error instanceof NotFoundError) return fail('tarefa não encontrada');
      if (error instanceof InvalidTransitionError) return fail('mudança de status não permitida');
      if (error instanceof ConflictError && error.code === 'tarefa_encerrada') return fail('tarefa já encerrada');
      if (error instanceof HoraInvalidaError) {
        return fail('essa hora não existe/é ambígua neste fuso (horário de verão)');
      }
      if (error instanceof InvalidInputError) return fail('argumento inválido: dueTime');
      if (error instanceof ValidationError) return fail('argumento inválido');
      throw error;
    }
  };
}
