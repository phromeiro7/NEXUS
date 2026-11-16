import type { TaskDto, UpdateTaskInput } from '@nexus/shared';
import { describe, expect, it } from 'vitest';
import { createFakes } from '../../../test/fakes.js';
import { newTask } from '../../../test/harness.js';
import { makeCalculateDeadline } from '../calculate-deadline.js';
import { makeTaskUseCases } from '../tasks.js';
import { ASSISTANT_TOOLS, makeToolExecutor } from './tools.js';

const U1 = 'user-1';
const U2 = 'user-2';
// 13:00Z = 10:00 em São Paulo (UTC-3, sem horário de verão)
const NOW = new Date('2026-10-26T13:00:00Z');

function setup(opts: { now?: Date } = {}) {
  const fakes = createFakes({ now: opts.now ?? NOW });
  const calculateDeadline = makeCalculateDeadline({ holidays: fakes.holidays });
  const base = makeTaskUseCases({
    tasks: fakes.tasks,
    cases: fakes.cases,
    profiles: fakes.profiles,
    reminders: fakes.reminders,
    calculateDeadline,
    clock: fakes.clock,
  });
  const calls = {
    create: [] as Array<{ userId: string; input: unknown; source: unknown }>,
    update: [] as Array<{ userId: string; id: string; input: UpdateTaskInput }>,
    get: 0,
    list: 0,
  };
  const failing = { create: false };
  const tasks: typeof base = {
    ...base,
    create: async (userId, input, source) => {
      calls.create.push({ userId, input, source });
      if (failing.create) throw new Error('db down');
      return base.create(userId, input, source);
    },
    update: async (userId, id, input) => {
      calls.update.push({ userId, id, input });
      return base.update(userId, id, input);
    },
    get: async (userId, id) => {
      calls.get += 1;
      return base.get(userId, id);
    },
    list: async (userId, query) => {
      calls.list += 1;
      return base.list(userId, query);
    },
  };
  const exec = makeToolExecutor({ tasks, calculateDeadline, profiles: fakes.profiles, clock: fakes.clock });
  const newCtx = (source: 'painel' | 'telegram' = 'painel') => ({
    source,
    affected: new Map<string, TaskDto>(),
    knownIds: new Set<string>(),
  });
  return { fakes, exec, calls, failing, newCtx };
}

const parse = (content: string) => JSON.parse(content) as Record<string, unknown>;

describe('ASSISTANT_TOOLS', () => {
  it('declares the five tools', () => {
    expect(ASSISTANT_TOOLS.map((t) => t.name)).toEqual([
      'criar_tarefa',
      'listar_tarefas',
      'alterar_tarefa',
      'concluir_tarefa',
      'calcular_prazo',
    ]);
  });

  it.each(ASSISTANT_TOOLS.map((t) => [t.name, t] as const))('%s has a closed JSON schema', (_name, tool) => {
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.inputSchema).not.toHaveProperty('$schema');
    expect(tool.inputSchema.type).toBe('object');
    expect(tool.description.length).toBeGreaterThan(40);
    expect('strict' in tool).toBe(false);
  });

  it('marks every IsoDate field with format date in the schema sent to the model', () => {
    const props = (name: string) =>
      (ASSISTANT_TOOLS.find((t) => t.name === name)!.inputSchema.properties as Record<string, Record<string, unknown>>);
    expect(props('criar_tarefa').dueDate).toMatchObject({ type: 'string', format: 'date' });
    expect(props('listar_tarefas').from).toMatchObject({ format: 'date' });
    expect(props('listar_tarefas').to).toMatchObject({ format: 'date' });
    expect(props('calcular_prazo').baseDate).toMatchObject({ format: 'date' });
    expect(JSON.stringify(props('alterar_tarefa').dueDate)).toContain('"format":"date"');
  });
});

describe('executor: validation', () => {
  it('rejects a non-existent date without calling the use case', async () => {
    const { exec, calls, newCtx } = setup();
    const r = await exec(U1, 'criar_tarefa', { title: 'Contestação', dueDate: '2026-02-30' }, newCtx());
    expect(r).toEqual({ content: 'argumento inválido: dueDate', isError: true });
    expect(calls.create).toHaveLength(0);
  });

  it('rejects dueTime without dueDate naming the field', async () => {
    const { exec, calls, newCtx } = setup();
    const r = await exec(U1, 'criar_tarefa', { title: 'Audiência', dueTime: '14:00' }, newCtx());
    expect(r).toEqual({ content: 'argumento inválido: dueTime', isError: true });
    expect(calls.create).toHaveLength(0);
  });

  it('never echoes input values in the error', async () => {
    const { exec, newCtx } = setup();
    const r = await exec(U1, 'criar_tarefa', { title: 'x'.repeat(201) }, newCtx());
    expect(r.isError).toBe(true);
    expect(r.content).toBe('argumento inválido: title');
    expect(r.content).not.toContain('xxx');
  });

  it('rejects a smuggled userId; the use case only ever sees the executor userId', async () => {
    const { exec, calls, newCtx } = setup();
    const bad = await exec(U1, 'criar_tarefa', { title: 'A', userId: U2 }, newCtx());
    expect(bad).toEqual({ content: 'argumento inválido: userId', isError: true });
    expect(calls.create).toHaveLength(0);

    const ok = await exec(U1, 'criar_tarefa', { title: 'A' }, newCtx());
    expect(ok.isError).toBe(false);
    expect(calls.create.map((c) => c.userId)).toEqual([U1]);
  });

  it('rejects alterar_tarefa with no field besides id', async () => {
    const { exec, newCtx } = setup();
    const ctx = newCtx();
    const r = await exec(U1, 'alterar_tarefa', { id: '3f2b8c1e-6f0a-4b7e-9a11-0c5d2e8f7a10' }, ctx);
    expect(r).toEqual({ content: 'argumento inválido: campos', isError: true });
  });

  it('rejects an unknown tool', async () => {
    const { exec, newCtx } = setup();
    expect(await exec(U1, 'apagar_tudo', {}, newCtx())).toEqual({ content: 'ferramenta desconhecida', isError: true });
  });
});

describe('executor: past rule', () => {
  it('today 08:00 with now 10:00 local -> horario_no_passado, nothing stored', async () => {
    const { exec, fakes, calls, newCtx } = setup();
    const r = await exec(U1, 'criar_tarefa', { title: 'Protocolar', dueDate: '2026-10-26', dueTime: '08:00' }, newCtx());
    expect(r.isError).toBe(true);
    expect(r.content.startsWith('horario_no_passado:')).toBe(true);
    expect(calls.create).toHaveLength(0);
    expect(await fakes.tasks.list(U1, {})).toEqual([]);
  });

  it('today later than now is accepted; the exact current minute too', async () => {
    const { exec, newCtx } = setup();
    expect((await exec(U1, 'criar_tarefa', { title: 'A', dueDate: '2026-10-26', dueTime: '10:01' }, newCtx())).isError).toBe(false);
    expect((await exec(U1, 'criar_tarefa', { title: 'B', dueDate: '2026-10-26', dueTime: '10:00' }, newCtx())).isError).toBe(false);
  });

  it('yesterday -> data_no_passado, nothing stored', async () => {
    const { exec, fakes, newCtx } = setup();
    const r = await exec(U1, 'criar_tarefa', { title: 'Protocolar', dueDate: '2026-10-25' }, newCtx());
    expect(r.isError).toBe(true);
    expect(r.content.startsWith('data_no_passado:')).toBe(true);
    expect(await fakes.tasks.list(U1, {})).toEqual([]);
  });

  it('uses the user time zone for "today" (Tokyo vs a UTC clock near midnight)', async () => {
    const { exec, fakes, newCtx } = setup({ now: new Date('2026-10-26T20:00:00Z') }); // 2026-10-27 05:00 JST
    fakes.setProfile(U1, { timezone: 'Asia/Tokyo' });
    const past = await exec(U1, 'criar_tarefa', { title: 'A', dueDate: '2026-10-26' }, newCtx());
    expect(past.content.startsWith('data_no_passado:')).toBe(true);
    const earlier = await exec(U1, 'criar_tarefa', { title: 'B', dueDate: '2026-10-27', dueTime: '04:00' }, newCtx());
    expect(earlier.content.startsWith('horario_no_passado:')).toBe(true);
    const later = await exec(U1, 'criar_tarefa', { title: 'C', dueDate: '2026-10-27', dueTime: '06:00' }, newCtx());
    expect(later.isError).toBe(false);
  });

  it('alterar_tarefa applies the rule to the patch and writes nothing', async () => {
    const { exec, fakes, calls, newCtx } = setup();
    const t = await fakes.tasks.create(U1, newTask('X', { dueDate: '2026-10-30' }));
    const ctx = newCtx();
    ctx.knownIds.add(t.id);
    const r = await exec(U1, 'alterar_tarefa', { id: t.id, dueDate: '2026-10-20' }, ctx);
    expect(r.content.startsWith('data_no_passado:')).toBe(true);
    expect(calls.update).toHaveLength(0);
    expect((await fakes.tasks.get(U1, t.id))?.dueDate).toBe('2026-10-30');
  });

  it('alterar_tarefa with only dueTime loads the task date to apply the rule', async () => {
    const { exec, fakes, calls, newCtx } = setup();
    const t = await fakes.tasks.create(U1, newTask('X', { dueDate: '2026-10-26', dueTime: '18:00' }));
    const ctx = newCtx();
    ctx.knownIds.add(t.id);
    const r = await exec(U1, 'alterar_tarefa', { id: t.id, dueTime: '08:00' }, ctx);
    expect(r.content.startsWith('horario_no_passado:')).toBe(true);
    expect(calls.update).toHaveLength(0);
    const ok = await exec(U1, 'alterar_tarefa', { id: t.id, dueTime: '11:00' }, ctx);
    expect(ok.isError).toBe(false);
    expect(parse(ok.content).dueTime).toBe('11:00');
  });
});

describe('executor: past rule on merged task state', () => {
  async function seeded(p: Parameters<typeof newTask>[1]) {
    const s = setup();
    const t = await s.fakes.tasks.create(U1, newTask('X', p));
    const ctx = s.newCtx();
    ctx.knownIds.add(t.id);
    return { ...s, t, ctx };
  }

  it('dueDate-only patch to today is checked against the stored time (bypass probe)', async () => {
    const { exec, fakes, calls, t, ctx } = await seeded({ dueDate: '2026-10-30', dueTime: '08:00' });
    const r = await exec(U1, 'alterar_tarefa', { id: t.id, dueDate: '2026-10-26' }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content.startsWith('horario_no_passado:')).toBe(true);
    expect(calls.update).toHaveLength(0);
    expect(await fakes.tasks.get(U1, t.id)).toEqual(t);
  });

  it('dueDate-only patch to today is allowed when the task has no stored time', async () => {
    const { exec, t, ctx } = await seeded({ dueDate: '2026-10-30' });
    const r = await exec(U1, 'alterar_tarefa', { id: t.id, dueDate: '2026-10-26' }, ctx);
    expect(r.isError).toBe(false);
    expect(parse(r.content).dueDate).toBe('2026-10-26');
  });

  it('dueDate moved to the future is allowed even if the stored time looks past', async () => {
    const { exec, t, ctx } = await seeded({ dueDate: '2026-10-26', dueTime: '08:00' });
    const r = await exec(U1, 'alterar_tarefa', { id: t.id, dueDate: '2026-10-28' }, ctx);
    expect(r.isError).toBe(false);
    expect(parse(r.content).dueDate).toBe('2026-10-28');
  });

  it('title-only and status-only patches on an overdue task are allowed', async () => {
    const { exec, t, ctx } = await seeded({ dueDate: '2026-10-20', dueTime: '08:00' });
    expect((await exec(U1, 'alterar_tarefa', { id: t.id, title: 'Novo' }, ctx)).isError).toBe(false);
    expect((await exec(U1, 'alterar_tarefa', { id: t.id, status: 'em_andamento' }, ctx)).isError).toBe(false);
    expect((await exec(U1, 'concluir_tarefa', { id: t.id }, ctx)).isError).toBe(false);
  });
});

describe('executor: ids and ownership', () => {
  it('alterar_tarefa with an id never listed -> id_desconhecido', async () => {
    const { exec, fakes, calls, newCtx } = setup();
    const t = await fakes.tasks.create(U1, newTask('X'));
    const r = await exec(U1, 'alterar_tarefa', { id: t.id, title: 'Y' }, newCtx());
    expect(r).toEqual({ content: 'id_desconhecido: liste as tarefas primeiro', isError: true });
    expect(calls.update).toHaveLength(0);
  });

  it('concluir_tarefa with an id never listed -> id_desconhecido', async () => {
    const { exec, fakes, newCtx } = setup();
    const t = await fakes.tasks.create(U1, newTask('X'));
    const r = await exec(U1, 'concluir_tarefa', { id: t.id }, newCtx());
    expect(r.content).toBe('id_desconhecido: liste as tarefas primeiro');
  });

  it("another user's task id (even if known) -> tarefa não encontrada, task untouched", async () => {
    const { exec, fakes, newCtx } = setup();
    const other = await fakes.tasks.create(U2, newTask('Do outro', { dueDate: '2026-10-30' }));
    const ctx = newCtx();
    ctx.knownIds.add(other.id);
    const alter = await exec(U1, 'alterar_tarefa', { id: other.id, title: 'Invadido' }, ctx);
    expect(alter).toEqual({ content: 'tarefa não encontrada', isError: true });
    const done = await exec(U1, 'concluir_tarefa', { id: other.id }, ctx);
    expect(done).toEqual({ content: 'tarefa não encontrada', isError: true });
    expect(await fakes.tasks.get(U2, other.id)).toEqual(other);
    expect(ctx.affected.size).toBe(0);
  });

  it('concluir_tarefa updates only { status: concluida }', async () => {
    const { exec, fakes, calls, newCtx } = setup();
    const t = await fakes.tasks.create(U1, newTask('X', { dueDate: '2026-10-30' }));
    const ctx = newCtx();
    ctx.knownIds.add(t.id);
    const r = await exec(U1, 'concluir_tarefa', { id: t.id }, ctx);
    expect(r.isError).toBe(false);
    expect(parse(r.content).status).toBe('concluida');
    expect(calls.update).toEqual([{ userId: U1, id: t.id, input: { status: 'concluida' } }]);
  });

  it('concluir_tarefa on an already closed task -> transition error text', async () => {
    const { exec, fakes, newCtx } = setup();
    const t = await fakes.tasks.create(U1, newTask('X', { status: 'cancelada' }));
    const ctx = newCtx();
    ctx.knownIds.add(t.id);
    const r = await exec(U1, 'concluir_tarefa', { id: t.id }, ctx);
    expect(r).toEqual({ content: 'mudança de status não permitida', isError: true });
  });

  it('editing fields of a closed task -> tarefa já encerrada', async () => {
    const { exec, fakes, newCtx } = setup();
    const t = await fakes.tasks.create(U1, newTask('X', { status: 'concluida', completedAt: NOW.toISOString() }));
    const ctx = newCtx();
    ctx.knownIds.add(t.id);
    const r = await exec(U1, 'alterar_tarefa', { id: t.id, title: 'Y' }, ctx);
    expect(r).toEqual({ content: 'tarefa já encerrada', isError: true });
  });

  it('affected has no duplicate ids and knownIds gains the id', async () => {
    const { exec, newCtx } = setup();
    const ctx = newCtx();
    const created = parse((await exec(U1, 'criar_tarefa', { title: 'A', dueDate: '2026-10-30' }, ctx)).content);
    const id = created.id as string;
    expect(ctx.knownIds.has(id)).toBe(true);
    await exec(U1, 'alterar_tarefa', { id, title: 'A2' }, ctx);
    await exec(U1, 'concluir_tarefa', { id }, ctx);
    expect([...ctx.affected.keys()]).toEqual([id]);
    expect(ctx.affected.get(id)?.status).toBe('concluida');
    expect(ctx.affected.get(id)?.title).toBe('A2');
  });

  it('criar_tarefa passes the channel source to the use case', async () => {
    const { exec, calls, newCtx } = setup();
    await exec(U1, 'criar_tarefa', { title: 'A' }, newCtx('telegram'));
    expect(calls.create[0]?.source).toBe('telegram');
  });
});

describe('executor: listar_tarefas', () => {
  it('truncates at 50 and reports the rest', async () => {
    const { exec, fakes, newCtx } = setup();
    for (let i = 0; i < 55; i += 1) await fakes.tasks.create(U1, newTask(`T${i}`, { dueDate: '2026-11-01' }));
    const ctx = newCtx();
    const r = await exec(U1, 'listar_tarefas', {}, ctx);
    expect(r.isError).toBe(false);
    const body = parse(r.content) as { items: unknown[]; maisResultados?: number };
    expect(body.items).toHaveLength(50);
    expect(body.maisResultados).toBe(5);
    expect(ctx.knownIds.size).toBe(50);
  });

  it('does not report maisResultados when everything fits and uses the compact shape', async () => {
    const { exec, fakes, newCtx } = setup();
    const t = await fakes.tasks.create(U1, newTask('Única', { dueDate: '2026-11-01', dueTime: '09:30', fatal: true, type: 'prazo' }));
    const r = await exec(U1, 'listar_tarefas', {}, newCtx());
    expect(parse(r.content)).toEqual({
      items: [
        { id: t.id, title: 'Única', type: 'prazo', status: 'pendente', dueDate: '2026-11-01', dueTime: '09:30', fatal: true },
      ],
    });
  });

  it('filters by query (case-insensitive substring on title)', async () => {
    const { exec, fakes, newCtx } = setup();
    await fakes.tasks.create(U1, newTask('Contestação do João'));
    await fakes.tasks.create(U1, newTask('Réplica'));
    const ctx = newCtx();
    const r = await exec(U1, 'listar_tarefas', { query: 'JOÃO' }, ctx);
    const items = (parse(r.content) as { items: Array<{ title: string }> }).items;
    expect(items.map((i) => i.title)).toEqual(['Contestação do João']);
    expect(ctx.knownIds.size).toBe(1);
  });

  it("only lists the executor user's tasks", async () => {
    const { exec, fakes, newCtx } = setup();
    await fakes.tasks.create(U2, newTask('Do outro'));
    const r = await exec(U1, 'listar_tarefas', {}, newCtx());
    expect(parse(r.content)).toEqual({ items: [] });
  });

  it('passes status/withoutDate filters through', async () => {
    const { exec, fakes, newCtx } = setup();
    await fakes.tasks.create(U1, newTask('Sem data'));
    await fakes.tasks.create(U1, newTask('Com data', { dueDate: '2026-11-01' }));
    await fakes.tasks.create(U1, newTask('Feita', { status: 'concluida' }));
    const r = await exec(U1, 'listar_tarefas', { withoutDate: true, status: ['pendente'] }, newCtx());
    expect((parse(r.content) as { items: Array<{ title: string }> }).items.map((i) => i.title)).toEqual(['Sem data']);
  });
});

describe('executor: calcular_prazo', () => {
  it('returns the deterministic result and rejects extra keys', async () => {
    const { exec, newCtx } = setup();
    const r = await exec(U1, 'calcular_prazo', { baseDate: '2026-10-26', days: 5, countType: 'corridos' }, newCtx());
    expect(r.isError).toBe(false);
    expect(parse(r.content)).toEqual({
      dueDate: '2026-11-03',
      prorrogado: true,
      feriadosDescontados: [{ date: '2026-11-02', name: 'Finados' }],
    });
    const bad = await exec(U1, 'calcular_prazo', { baseDate: '2026-10-26', days: 5, countType: 'corridos', userId: U2 }, newCtx());
    expect(bad).toEqual({ content: 'argumento inválido: userId', isError: true });
  });
});

describe('executor: error mapping', () => {
  it('HoraInvalidaError (DST gap) -> DST message', async () => {
    const { exec, fakes, newCtx } = setup({ now: new Date('2026-03-01T12:00:00Z') });
    fakes.setProfile(U1, { timezone: 'America/New_York' });
    const r = await exec(U1, 'criar_tarefa', { title: 'A', dueDate: '2026-03-08', dueTime: '02:30' }, newCtx());
    expect(r).toEqual({
      content: 'essa hora não existe/é ambígua neste fuso (horário de verão)',
      isError: true,
    });
    expect(await fakes.tasks.list(U1, {})).toEqual([]);
  });

  it('rethrows non-domain failures instead of converting them', async () => {
    const { exec, failing, newCtx } = setup();
    failing.create = true;
    await expect(exec(U1, 'criar_tarefa', { title: 'A' }, newCtx())).rejects.toThrow('db down');
  });
});
