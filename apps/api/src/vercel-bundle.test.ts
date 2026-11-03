import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildVercelOutput } from '../scripts/build-vercel.js';

describe('vercel build output', () => {
  it('emits Build Output API v3 and the built handler answers GET /health over http', async () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-fake';
    const bundle = await buildVercelOutput();
    const output = resolve(dirname(bundle), '../..');

    expect(JSON.parse(readFileSync(resolve(output, 'config.json'), 'utf8'))).toEqual({
      version: 3,
      routes: [{ handle: 'filesystem' }, { src: '/(.*)', dest: '/api' }],
    });
    expect(JSON.parse(readFileSync(resolve(dirname(bundle), '.vc-config.json'), 'utf8'))).toMatchObject({
      runtime: 'nodejs22.x',
      handler: 'index.js',
      launcherType: 'Nodejs',
      maxDuration: 60,
      regions: ['gru1'],
    });

    const listener = createRequire(import.meta.url)(bundle) as Parameters<typeof createServer>[1];
    const server = createServer(listener);
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
      const anon = await fetch(`http://127.0.0.1:${port}/me`);
      expect(anon.status).toBe(401);
    } finally {
      await new Promise((ok) => server.close(ok));
    }
  }, 60_000);
});
