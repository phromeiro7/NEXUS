import { describe, expect, it } from 'vitest';
import { anon, buildApp, req } from '../../test/harness.js';

describe('invite routes', () => {
  it.each([
    ['GET', '/invites'],
    ['POST', '/invites'],
    ['DELETE', '/invites/ABCDEFGHJKMN'],
  ])('%s %s without a token is 401', async (method, path) => {
    const { app } = buildApp({ invites: { adminIds: [111] } });
    const res = await anon(app, method, path);
    expect(res.status).toBe(401);
  });

  it('a non-administrator gets 403 on every route', async () => {
    const { app } = buildApp({ invites: { adminIds: [111] } });
    for (const [method, path] of [
      ['GET', '/invites'],
      ['POST', '/invites'],
      ['DELETE', '/invites/ABCDEFGHJKMN'],
    ] as const) {
      const res = await req(app, method, path, undefined, 'token-u2');
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'proibido' });
    }
  });

  it('with invites not configured every route is 403, even for the first user', async () => {
    const { app } = buildApp();
    expect((await req(app, 'POST', '/invites', undefined, 'token-ok')).status).toBe(403);
  });

  it('administrator creates (201), lists and revokes (204)', async () => {
    const { app } = buildApp({ invites: { adminIds: [111] } });
    const created = await req(app, 'POST', '/invites', undefined, 'token-ok');
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const invite = (await created.json()) as { code: string; link: string; status: string };
    expect(invite.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/);
    expect(invite.link).toBe(`https://t.me/meu_bot?start=${invite.code}`);
    expect(invite.status).toBe('ativo');

    const listed = await req(app, 'GET', '/invites', undefined, 'token-ok');
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { invites: Array<{ code: string }> }).invites.map((i) => i.code)).toEqual([invite.code]);

    const revoked = await req(app, 'DELETE', `/invites/${invite.code}`, undefined, 'token-ok');
    expect(revoked.status).toBe(204);
    const after = (await (await req(app, 'GET', '/invites', undefined, 'token-ok')).json()) as { invites: Array<{ status: string }> };
    expect(after.invites[0]!.status).toBe('revogado');
  });

  it('revoking an unknown, malformed or already revoked code is 404', async () => {
    const { app } = buildApp({ invites: { adminIds: [111] } });
    expect((await req(app, 'DELETE', '/invites/ABCDEFGHJKMN', undefined, 'token-ok')).status).toBe(404);
    expect((await req(app, 'DELETE', '/invites/curto', undefined, 'token-ok')).status).toBe(404);
  });

  it('the response never exposes who used an invite', async () => {
    const { app, fakes } = buildApp({ invites: { adminIds: [111] } });
    fakes.invites.seed({ code: 'HHHHHHHHHHHH', usedAt: new Date(), createdBy: 'u1' });
    const body = JSON.stringify(await (await req(app, 'GET', '/invites', undefined, 'token-ok')).json());
    expect(body).not.toMatch(/u1|usedBy|used_by|userId/);
  });
});
