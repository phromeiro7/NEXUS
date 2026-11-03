import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { buildApp } from '../../test/harness.js';
import type { makeTaskUseCases } from '../application/tasks.js';

const MISSING = '11111111-1111-4111-8111-111111111111';

function build(opts: { verifierThrows?: boolean; tasksOverride?: Partial<ReturnType<typeof makeTaskUseCases>> } = {}) {
  return buildApp(opts);
}

type App = ReturnType<typeof build>['app'];
const headers = (token = 'token-ok') => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const req = (app: App, method: string, path: string, body?: unknown, token = 'token-ok') =>
  app.request(path, {
    method,
    headers: headers(token),
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('task routes', () => {
  let errorSpy: MockInstance<typeof console.error>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it.each([
    ['GET', '/tasks'],
    ['POST', '/tasks'],
    ['GET', `/tasks/${MISSING}`],
    ['PATCH', `/tasks/${MISSING}`],
    ['DELETE', `/tasks/${MISSING}`],
  ])('%s %s without token is 401', async (method, path) => {
    const { app } = build();
    const res = await app.request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' || method === 'PATCH' ? JSON.stringify({ title: 'x' }) : undefined,
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'nao_autenticado' });
  });

  it('POST creates a task and returns 201 with the exact TaskDto', async () => {
    const { app, fakes } = build();
    const res = await req(app, 'POST', '/tasks', { title: 'Ligar ao cliente', dueDate: '2026-10-30' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body).toEqual({
      id: expect.any(String),
      caseId: null,
      title: 'Ligar ao cliente',
      type: 'tarefa',
      status: 'pendente',
      dueDate: '2026-10-30',
      dueTime: null,
      fatal: false,
      baseDate: null,
      periodDays: null,
      countType: null,
      completedAt: null,
      createdAt: '2026-10-26T12:00:00.000Z',
      updatedAt: '2026-10-26T12:00:00.000Z',
    });
    expect((await fakes.tasks.list('u1', {})).map((t) => t.id)).toEqual([body.id]);
  });

  it('POST with an invalid body is 400 with issues pointing at the field', async () => {
    const res = await req(build().app, 'POST', '/tasks', { title: '' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: { path: unknown[] }[] };
    expect(body.error).toBe('entrada_invalida');
    expect(body.issues.some((i) => i.path[0] === 'title')).toBe(true);
  });

  it.each(['{nope', ''])('POST with malformed or empty body %j is 400', async (raw) => {
    const res = await req(build().app, 'POST', '/tasks', raw);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'entrada_invalida', issues: expect.anything() });
  });

  it('PATCH with malformed JSON is 400', async () => {
    const res = await req(build().app, 'PATCH', `/tasks/${MISSING}`, '{nope');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('entrada_invalida');
  });

  it('GET /tasks filters by query and only returns the caller tasks', async () => {
    const { app, fakes } = build();
    const mk = (userId: string, title: string, dueDate: string, status?: 'em_andamento' | 'concluida') =>
      fakes.tasks
        .create(userId, {
          caseId: null, title, type: 'tarefa', status: status ?? 'pendente', dueDate, dueTime: null, fatal: false,
          baseDate: null, periodDays: null, countType: null, completedAt: null, source: 'painel', sourceText: null,
        })
        .then((t) => t.id);
    const a = await mk('u1', 'a', '2026-10-26');
    const b = await mk('u1', 'b', '2026-10-27', 'em_andamento');
    await mk('u1', 'c', '2026-10-25'); // antes de from
    await mk('u1', 'd', '2026-10-28', 'concluida'); // status fora
    await mk('u2', 'e', '2026-10-26'); // outro usuário
    const res = await req(app, 'GET', '/tasks?status=pendente,em_andamento&from=2026-10-26');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }[]).map((t) => t.id)).toEqual([a, b]);
  });

  it('GET /tasks with from after to is 400', async () => {
    const res = await req(build().app, 'GET', '/tasks?from=2026-11-02&to=2026-11-01');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('entrada_invalida');
  });

  it('GET /tasks with an invalid status is 400', async () => {
    const res = await req(build().app, 'GET', '/tasks?status=bogus');
    expect(res.status).toBe(400);
  });

  it('GET of a missing uuid is 404', async () => {
    const res = await req(build().app, 'GET', `/tasks/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'nao_encontrado' });
  });

  it.each([
    ['GET', undefined],
    ['PATCH', { title: 'x' }],
    ['DELETE', undefined],
  ])('%s with a malformed id is 404 before reaching the use case', async (method, body) => {
    const boom = vi.fn(async () => {
      throw new Error('nao deveria chegar');
    });
    const { app } = build({ tasksOverride: { get: boom, update: boom, remove: boom } });
    const res = await req(app, method, '/tasks/abc', body);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'nao_encontrado' });
    expect(boom).not.toHaveBeenCalled();
  });

  it("another user's task is 404 on GET, PATCH and DELETE and stays unchanged", async () => {
    const { app, fakes } = build();
    const created = (await (await req(app, 'POST', '/tasks', { title: 'segredo' })).json()) as { id: string };
    const expected = await fakes.tasks.get('u1', created.id);

    for (const [method, body] of [['GET', undefined], ['PATCH', { title: 'hack' }], ['DELETE', undefined]] as const) {
      const res = await req(app, method, `/tasks/${created.id}`, body, 'token-u2');
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'nao_encontrado' });
    }
    expect(await fakes.tasks.get('u1', created.id)).toEqual(expected);
  });

  it('PATCH of a closed task changing the title is 409 tarefa_encerrada', async () => {
    const { app } = build();
    const created = (await (await req(app, 'POST', '/tasks', { title: 'x' })).json()) as { id: string };
    expect((await req(app, 'PATCH', `/tasks/${created.id}`, { status: 'concluida' })).status).toBe(200);
    const res = await req(app, 'PATCH', `/tasks/${created.id}`, { title: 'novo' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'tarefa_encerrada' });
  });

  it('PATCH with an invalid transition is 409 transicao_invalida', async () => {
    const { app } = build();
    const created = (await (await req(app, 'POST', '/tasks', { title: 'x' })).json()) as { id: string };
    await req(app, 'PATCH', `/tasks/${created.id}`, { status: 'concluida' });
    const res = await req(app, 'PATCH', `/tasks/${created.id}`, { status: 'em_andamento' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'transicao_invalida', from: 'concluida', to: 'em_andamento' });
  });

  it('POST with a nonexistent local time is 422 hora_invalida and stores nothing', async () => {
    const { app, fakes } = build();
    fakes.setProfile('u1', { timezone: 'America/New_York' });
    fakes.setNow(new Date('2026-03-01T12:00:00Z'));
    const res = await req(app, 'POST', '/tasks', { title: 'x', dueDate: '2026-03-08', dueTime: '02:30' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'hora_invalida', reason: 'hora_inexistente' });
    const list = await req(app, 'GET', '/tasks');
    expect(await list.json()).toEqual([]);
  });

  it('PATCH dueTime on an undated task is 400 hora_sem_data', async () => {
    const { app } = build();
    const created = (await (await req(app, 'POST', '/tasks', { title: 'x' })).json()) as { id: string };
    const res = await req(app, 'PATCH', `/tasks/${created.id}`, { dueTime: '09:00' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'entrada_invalida', code: 'hora_sem_data' });
  });

  it('DELETE is 204 with empty body and then GET is 404', async () => {
    const { app } = build();
    const created = (await (await req(app, 'POST', '/tasks', { title: 'x' })).json()) as { id: string };
    const del = await req(app, 'DELETE', `/tasks/${created.id}`);
    expect(del.status).toBe(204);
    expect(await del.text()).toBe('');
    const res = await req(app, 'GET', `/tasks/${created.id}`);
    expect(res.status).toBe(404);
  });

  it('PATCH updates and returns the TaskDto', async () => {
    const { app } = build();
    const created = (await (await req(app, 'POST', '/tasks', { title: 'x' })).json()) as { id: string };
    const res = await req(app, 'PATCH', `/tasks/${created.id}`, { title: 'novo', fatal: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: created.id, title: 'novo', fatal: true });
  });

  it('body userId/user_id cannot override the token user', async () => {
    const { app, fakes } = build();
    const res = await req(app, 'POST', '/tasks', { title: 'x', userId: 'u2', user_id: 'u2' });
    expect(res.status).toBe(201);
    expect(await fakes.tasks.list('u1', {})).toHaveLength(1);
    expect(await fakes.tasks.list('u2', {})).toHaveLength(0);
  });

  it('query userId cannot override the token user', async () => {
    const { app, fakes } = build();
    await fakes.tasks.create('u2', {
      caseId: null, title: 'do outro', type: 'tarefa', status: 'pendente', dueDate: null, dueTime: null, fatal: false,
      baseDate: null, periodDays: null, countType: null, completedAt: null, source: 'painel', sourceText: null,
    });
    const res = await req(app, 'GET', '/tasks?userId=u2&user_id=u2');
    expect(await res.json()).toEqual([]);
  });

  it('an unexpected error is 500 erro_interno, hides the message and logs once', async () => {
    const { app } = build({
      tasksOverride: {
        list: async () => {
          throw new Error('relation "tasks" violates constraint x');
        },
      },
    });
    const res = await req(app, 'GET', '/tasks');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'erro_interno' });
    expect(text).not.toContain('constraint');
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('mapped errors do not log as unhandled', async () => {
    await req(build().app, 'GET', `/tasks/${MISSING}`);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('a verifier that throws is 500, not 401', async () => {
    const res = await req(build({ verifierThrows: true }).app, 'GET', '/tasks');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'erro_interno' });
  });
});
