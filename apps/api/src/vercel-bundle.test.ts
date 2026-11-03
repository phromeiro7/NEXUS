import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildVercelBundle } from '../scripts/build-vercel.js';

describe('vercel bundle', () => {
  it('builds and the built bundle answers GET /health', async () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-fake';
    const file = await buildVercelBundle();
    const mod = (await import(pathToFileURL(file).href)) as { default: { fetch: (r: Request) => Promise<Response> } };
    const res = await mod.default.fetch(new Request('http://x/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  }, 60_000);
});
