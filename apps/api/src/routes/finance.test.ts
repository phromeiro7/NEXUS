import { describe, expect, it } from 'vitest';
import { anon, buildApp, req } from '../../test/harness.js';

const MISSING = '11111111-1111-4111-8111-111111111111';
const gasto = { kind: 'gasto', description: 'Almoço', amountCents: 4200, dueDate: '2026-11-04' };
const conta = {
  kind: 'conta',
  description: 'Aluguel',
  amountCents: 120000,
  dueDate: '2026-11-05',
  status: 'a_pagar',
  reminderTime: '09:00',
};

async function create(app: ReturnType<typeof buildApp>['app'], body: unknown, token = 'token-ok') {
  const res = await req(app, 'POST', '/finance-entries', body, token);
  return { res, body: (await res.json()) as Record<string, unknown> };
}

describe('finance routes', () => {
  it.each([
    ['GET', '/finance-entries'],
    ['POST', '/finance-entries'],
    ['PATCH', `/finance-entries/${MISSING}`],
    ['DELETE', `/finance-entries/${MISSING}`],
  ])('%s %s without token is 401, even with an invalid body', async (method, path) => {
    const { app } = buildApp();
    const res = await anon(app, method, path, method === 'GET' || method === 'DELETE' ? undefined : '{nope');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'nao_autenticado' });
  });

  it('POST creates: 201 with the exact FinanceEntryDto, and GET lists it', async () => {
    const { app } = buildApp();
    const { res, body } = await create(app, gasto);
    expect(res.status).toBe(201);
    expect(body).toEqual({
      id: expect.any(String),
      kind: 'gasto',
      description: 'Almoço',
      amountCents: 4200,
      category: null,
      dueDate: '2026-11-04',
      status: 'paga',
      reminderTime: null,
      paidAt: expect.any(String),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    const list = await req(app, 'GET', '/finance-entries');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([body]);
  });

  it('POST with a repeated client id is 409 lancamento_ja_cadastrado', async () => {
    const { app } = buildApp();
    const id = '0b6f0c4e-1c1e-4e2a-9d3a-5f7f2d9f6a11';
    expect((await create(app, { ...gasto, id })).res.status).toBe(201);
    const again = await create(app, { ...gasto, id });
    expect(again.res.status).toBe(409);
    expect(again.body).toEqual({ error: 'lancamento_ja_cadastrado' });
  });

  it.each([
    { ...gasto, amountCents: 0 },
    { ...gasto, amountCents: 10.5 },
    { ...gasto, description: '' },
    { ...gasto, dueDate: '2026-02-31' },
    { ...gasto, status: 'a_pagar' },
    { ...gasto, userId: 'u2' },
    { description: 'sem tipo' },
    '{nope',
  ])('POST with invalid body %j is 400', async (body) => {
    const { res, body: json } = await create(buildApp().app, body);
    expect(res.status).toBe(400);
    expect(json.error).toBe('entrada_invalida');
  });

  it('GET filters by month, status and range, and never leaks another user', async () => {
    const { app } = buildApp();
    await create(app, { ...gasto, dueDate: '2026-10-30' });
    await create(app, conta);
    await create(app, { ...gasto, description: 'Do outro usuário' }, 'token-u2');

    const names = async (qs: string) =>
      ((await (await req(app, 'GET', `/finance-entries${qs}`)).json()) as { description: string }[]).map(
        (e) => e.description,
      );
    expect(await names('')).toHaveLength(2);
    expect(await names('?month=2026-11')).toEqual(['Aluguel']);
    expect(await names('?status=a_pagar')).toEqual(['Aluguel']);
    expect(await names('?from=2026-10-01&to=2026-10-31')).toEqual(['Almoço']);
    expect(await names('')).not.toContain('Do outro usuário');
  });

  it.each(['?month=2026-13', '?status=atrasada', '?from=2026-12-01&to=2026-01-01', '?month=2026-11&from=2026-11-01'])(
    'GET %s is 400',
    async (qs) => {
      const res = await req(buildApp().app, 'GET', `/finance-entries${qs}`);
      expect(res.status).toBe(400);
    },
  );

  it('PATCH pays and undoes, setting and clearing paidAt', async () => {
    const { app } = buildApp();
    const { body: created } = await create(app, conta);
    const paid = await req(app, 'PATCH', `/finance-entries/${created.id}`, { status: 'paga' });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toMatchObject({ id: created.id, status: 'paga', paidAt: expect.any(String) });
    const undone = await req(app, 'PATCH', `/finance-entries/${created.id}`, { status: 'a_pagar' });
    expect(await undone.json()).toMatchObject({ status: 'a_pagar', paidAt: null });
  });

  it.each([{}, { status: 'atrasada' }, { amountCents: -1 }, { kind: 'gasto' }, '{nope'])(
    'PATCH with invalid body %j is 400',
    async (body) => {
      const { app } = buildApp();
      const { body: created } = await create(app, conta);
      const res = await req(app, 'PATCH', `/finance-entries/${created.id}`, body);
      expect(res.status).toBe(400);
    },
  );

  it('PATCH that would turn a gasto into a_pagar is 400 lancamento_inconsistente', async () => {
    const { app } = buildApp();
    const { body: created } = await create(app, gasto);
    const res = await req(app, 'PATCH', `/finance-entries/${created.id}`, { status: 'a_pagar' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'entrada_invalida', code: 'lancamento_inconsistente' });
  });

  it('another user gets 404 on PATCH and DELETE, and the entry stays untouched', async () => {
    const { app } = buildApp();
    const { body: created } = await create(app, conta);
    const patch = await req(app, 'PATCH', `/finance-entries/${created.id}`, { status: 'paga' }, 'token-u2');
    expect(patch.status).toBe(404);
    expect(await patch.json()).toEqual({ error: 'nao_encontrado' });
    expect((await req(app, 'DELETE', `/finance-entries/${created.id}`, undefined, 'token-u2')).status).toBe(404);
    const list = (await (await req(app, 'GET', '/finance-entries')).json()) as { status: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe('a_pagar');
  });

  it('malformed or unknown ids are 404', async () => {
    const { app } = buildApp();
    expect((await req(app, 'PATCH', '/finance-entries/abc', { status: 'paga' })).status).toBe(404);
    expect((await req(app, 'DELETE', '/finance-entries/abc')).status).toBe(404);
    expect((await req(app, 'DELETE', `/finance-entries/${MISSING}`)).status).toBe(404);
  });

  it('DELETE is 204 with an empty body, then the list is empty', async () => {
    const { app } = buildApp();
    const { body: created } = await create(app, gasto);
    const res = await req(app, 'DELETE', `/finance-entries/${created.id}`);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(await (await req(app, 'GET', '/finance-entries')).json()).toEqual([]);
  });
});
