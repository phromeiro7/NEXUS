import { describe, expect, it, vi } from 'vitest';
import { createFetchHandler } from './handler.js';

const baseEnv = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-fake',
};

describe('createFetchHandler', () => {
  it('GET /health answers 200 through the real compose', async () => {
    const res = await createFetchHandler(baseEnv)(new Request('http://x/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('protected route without token is 401', async () => {
    const res = await createFetchHandler(baseEnv)(new Request('http://x/tasks'));
    expect(res.status).toBe(401);
  });

  it('POST /internal/reminders/run is 503 when INTERNAL_SECRET is unset', async () => {
    const res = await createFetchHandler(baseEnv)(new Request('http://x/internal/reminders/run', { method: 'POST' }));
    expect(res.status).toBe(503);
  });

  it('missing config yields a 500 naming the variable, never a value', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = createFetchHandler({ SUPABASE_URL: 'https://valor-secreto.example.com' });
    const res = await handler(new Request('http://x/health'));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(text).not.toContain('valor-secreto');
    spy.mockRestore();
  });
});
