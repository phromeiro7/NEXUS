import { describe, expect, it } from 'vitest';
import { anon, buildApp, req } from '../../test/harness.js';

const MISSING = '11111111-1111-4111-8111-111111111111';

describe('case routes', () => {
  it.each([
    ['GET', '/cases'],
    ['POST', '/cases'],
    ['GET', `/cases/${MISSING}`],
    ['PATCH', `/cases/${MISSING}`],
  ])('%s %s without token is 401, even with an invalid body', async (method, path) => {
    const { app } = buildApp();
    const res = await anon(app, method, path, method === 'POST' || method === 'PATCH' ? '{nope' : undefined);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'nao_autenticado' });
  });

  it('POST creates a case: 201 with the exact CaseDto', async () => {
    const { app } = buildApp();
    const res = await req(app, 'POST', '/cases', { number: '0001-23.2026', clientName: 'Maria' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: expect.any(String),
      number: '0001-23.2026',
      clientName: 'Maria',
      description: null,
      status: 'ativo',
      createdAt: '2026-10-26T12:00:00.000Z',
      updatedAt: '2026-10-26T12:00:00.000Z',
    });
  });

  it('POST with a duplicate number is 409 numero_ja_cadastrado', async () => {
    const { app } = buildApp();
    await req(app, 'POST', '/cases', { number: 'A-1' });
    const res = await req(app, 'POST', '/cases', { number: 'A-1' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'numero_ja_cadastrado' });
  });

  it.each(['{nope', '', '{}', '{"number":""}'])('POST with invalid body %j is 400', async (body) => {
    const res = await req(buildApp().app, 'POST', '/cases', body === '' ? undefined : body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('entrada_invalida');
  });

  it('GET /:id returns the case; PATCH archives it', async () => {
    const { app } = buildApp();
    const created = (await (await req(app, 'POST', '/cases', { number: 'A-1' })).json()) as { id: string };
    const got = await req(app, 'GET', `/cases/${created.id}`);
    expect(got.status).toBe(200);
    expect(((await got.json()) as { number: string }).number).toBe('A-1');

    const res = await req(app, 'PATCH', `/cases/${created.id}`, { status: 'arquivado' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: created.id, number: 'A-1', status: 'arquivado' });
  });

  it('PATCH with an empty body is 400', async () => {
    const { app } = buildApp();
    const created = (await (await req(app, 'POST', '/cases', { number: 'A-1' })).json()) as { id: string };
    const res = await req(app, 'PATCH', `/cases/${created.id}`, {});
    expect(res.status).toBe(400);
  });

  it('GET ?status filters and returns only the caller cases', async () => {
    const { app, fakes } = buildApp();
    const a = await fakes.cases.create('u1', { number: 'U1-ativo' });
    const b = await fakes.cases.create('u1', { number: 'U1-arq' });
    await fakes.cases.update('u1', b.id, { status: 'arquivado' });
    const c = await fakes.cases.create('u2', { number: 'U2-arq' });
    await fakes.cases.update('u2', c.id, { status: 'arquivado' });

    const arch = await req(app, 'GET', '/cases?status=arquivado');
    expect(arch.status).toBe(200);
    expect(((await arch.json()) as { id: string }[]).map((x) => x.id)).toEqual([b.id]);

    const all = await req(app, 'GET', '/cases');
    expect(((await all.json()) as { id: string }[]).map((x) => x.id)).toEqual([a.id, b.id]);
  });

  it('GET ?status=xyz is 400', async () => {
    const res = await req(buildApp().app, 'GET', '/cases?status=xyz');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('entrada_invalida');
  });

  it("another user's case is a generic 404 on GET and PATCH, and stays unchanged", async () => {
    const { app, fakes } = buildApp();
    const mine = await fakes.cases.create('u1', { number: 'U1-1' });
    const get = await req(app, 'GET', `/cases/${mine.id}`, undefined, 'token-u2');
    expect(get.status).toBe(404);
    expect(await get.json()).toEqual({ error: 'nao_encontrado' });
    const patch = await req(app, 'PATCH', `/cases/${mine.id}`, { status: 'arquivado' }, 'token-u2');
    expect(patch.status).toBe(404);
    expect(await patch.json()).toEqual({ error: 'nao_encontrado' });
    expect(await fakes.cases.get('u1', mine.id)).toEqual(mine);
  });

  it('a non-UUID id is 404 nao_encontrado', async () => {
    const { app } = buildApp();
    for (const method of ['GET', 'PATCH']) {
      const res = await req(app, method, '/cases/nao-e-uuid', method === 'PATCH' ? { status: 'arquivado' } : undefined);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'nao_encontrado' });
    }
  });

  it('userId cannot be overridden by body or query', async () => {
    const { app, fakes } = buildApp();
    await fakes.cases.create('u2', { number: 'U2-1' });
    const res = await req(app, 'POST', '/cases?userId=u2', { number: 'X-1', userId: 'u2' });
    expect(res.status).toBe(201);
    expect((await fakes.cases.list('u2', {})).map((c) => c.number)).toEqual(['U2-1']);
    expect((await fakes.cases.list('u1', {})).map((c) => c.number)).toEqual(['X-1']);
    const list = await req(app, 'GET', '/cases?userId=u2');
    expect(((await list.json()) as { number: string }[]).map((c) => c.number)).toEqual(['X-1']);
  });
});
