import { describe, expect, it, vi } from 'vitest';
import { anon, buildApp, req } from '../../test/harness.js';

const MISSING = '11111111-1111-4111-8111-111111111111';
const holiday = { date: '2026-11-05', scope: 'municipal', name: 'Aniversario da cidade' };

describe('holiday routes', () => {
  it.each([
    ['GET', '/holidays'],
    ['POST', '/holidays'],
    ['DELETE', `/holidays/${MISSING}`],
  ])('%s %s without token is 401, even with an invalid body', async (method, path) => {
    const { app } = buildApp();
    const res = await anon(app, method, path, method === 'POST' ? '{nope' : undefined);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'nao_autenticado' });
  });

  it('POST creates: 201 with the exact HolidayDto, and GET lists it', async () => {
    const { app } = buildApp();
    const res = await req(app, 'POST', '/holidays', holiday);
    expect(res.status).toBe(201);
    const dto = { id: expect.any(String), ...holiday };
    expect(await res.json()).toEqual(dto);
    const list = await req(app, 'GET', '/holidays');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([dto]);
  });

  it('POST with a duplicate date is 409 feriado_ja_cadastrado', async () => {
    const { app } = buildApp();
    await req(app, 'POST', '/holidays', holiday);
    const res = await req(app, 'POST', '/holidays', holiday);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'feriado_ja_cadastrado' });
  });

  it.each([{ ...holiday, scope: 'nacional' }, { ...holiday, date: '2026-02-31' }, { date: holiday.date }, '{nope'])(
    'POST with invalid body %j is 400',
    async (body) => {
      const res = await req(buildApp().app, 'POST', '/holidays', body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('entrada_invalida');
    },
  );

  it('DELETE is 204 with no content-type and an empty body, then the list is empty', async () => {
    const { app } = buildApp();
    const created = (await (await req(app, 'POST', '/holidays', holiday)).json()) as { id: string };
    const res = await req(app, 'DELETE', `/holidays/${created.id}`);
    expect(res.status).toBe(204);
    expect(res.headers.get('content-type')).toBeNull();
    expect(await res.text()).toBe('');
    expect(await (await req(app, 'GET', '/holidays')).json()).toEqual([]);
  });

  it("another user's DELETE is a generic 404 and the holiday stays listed", async () => {
    const { app } = buildApp();
    const created = (await (await req(app, 'POST', '/holidays', holiday)).json()) as { id: string };
    const res = await req(app, 'DELETE', `/holidays/${created.id}`, undefined, 'token-u2');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'nao_encontrado' });
    const list = (await (await req(app, 'GET', '/holidays')).json()) as { id: string }[];
    expect(list.map((h) => h.id)).toEqual([created.id]);
  });

  it('DELETE with a malformed id is 404 before the use case', async () => {
    const boom = vi.fn(async () => {
      throw new Error('nao deveria chegar');
    });
    const { app } = buildApp({ holidaysOverride: { remove: boom } });
    const res = await req(app, 'DELETE', '/holidays/abc');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'nao_encontrado' });
    expect(boom).not.toHaveBeenCalled();
  });

  it('userId cannot be overridden by body or query', async () => {
    const { app, fakes } = buildApp();
    await req(app, 'POST', '/holidays', { date: '2026-12-08', scope: 'estadual', name: 'Do u2' }, 'token-u2');
    const res = await req(app, 'POST', '/holidays?userId=u2', { ...holiday, userId: 'u2' });
    expect(res.status).toBe(201);
    expect((await fakes.holidays.list('u2')).map((h) => h.name)).toEqual(['Do u2']);
    expect((await fakes.holidays.list('u1')).map((h) => h.name)).toEqual([holiday.name]);
    const list = (await (await req(app, 'GET', '/holidays?userId=u2')).json()) as { name: string }[];
    expect(list.map((h) => h.name)).toEqual([holiday.name]);
  });
});
