import { describe, expect, it } from 'vitest';
import { anon, buildApp, req } from '../../test/harness.js';

describe('capture routes', () => {
  it('POST /capture/interpret without token is 401, even with an invalid body', async () => {
    const { app } = buildApp();
    const res = await anon(app, 'POST', '/capture/interpret', '{nope');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'nao_autenticado' });
  });

  it('interprets a sentence and writes nothing', async () => {
    const { app } = buildApp({ now: new Date('2026-11-04T15:00:00Z') });
    const res = await req(app, 'POST', '/capture/interpret', { text: 'gastei 100 em roupa' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      today: '2026-11-04',
      proposal: { kind: 'gasto', description: 'roupa', amountCents: 10000, category: 'Roupas', date: '2026-11-04', time: null, status: 'paga' },
    });
    const list = await req(app, 'GET', '/finance-entries');
    expect(await list.json()).toEqual([]);
  });

  it('answers 200 with proposal null when the rules do not understand', async () => {
    const { app } = buildApp();
    const res = await req(app, 'POST', '/capture/interpret', { text: 'oi' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ proposal: null });
  });

  it('rejects an empty or oversized text with 400', async () => {
    const { app } = buildApp();
    expect((await req(app, 'POST', '/capture/interpret', { text: '   ' })).status).toBe(400);
    expect((await req(app, 'POST', '/capture/interpret', { text: 'a'.repeat(501) })).status).toBe(400);
    expect((await req(app, 'POST', '/capture/interpret', {})).status).toBe(400);
  });
});
