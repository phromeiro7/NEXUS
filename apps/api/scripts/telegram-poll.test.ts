import { describe, expect, it, vi } from 'vitest';
import { buildPollConfig, pollLoop, type PollDeps } from './telegram-poll.js';

const env = { TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_WEBHOOK_SECRET: 'segredo-de-teste-123' };

describe('buildPollConfig', () => {
  it('defaults to the local API on port 3001', () => {
    expect(buildPollConfig(env).webhookUrl).toBe('http://localhost:3001/telegram/webhook');
    expect(buildPollConfig({ ...env, PORT: '4000' }).webhookUrl).toBe('http://localhost:4000/telegram/webhook');
  });

  it.each(['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'])('requires %s and names it', (name) => {
    expect(() => buildPollConfig({ ...env, [name]: ' ' })).toThrow(name);
  });

  it('refuses plain http outside localhost and non-http schemes', () => {
    expect(() => buildPollConfig({ ...env, TELEGRAM_POLL_URL: 'http://api.example.com' })).toThrow('TELEGRAM_POLL_URL');
    expect(() => buildPollConfig({ ...env, TELEGRAM_POLL_URL: 'ftp://localhost' })).toThrow('TELEGRAM_POLL_URL');
    expect(buildPollConfig({ ...env, TELEGRAM_POLL_URL: 'https://api.example.com/' }).webhookUrl).toBe(
      'https://api.example.com/telegram/webhook',
    );
  });
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>, stopAfterSleeps = 1) {
  const controller = new AbortController();
  const calls: { url: string; init: RequestInit }[] = [];
  let sleeps = 0;
  const log = vi.fn();
  const deps: PollDeps = {
    config: buildPollConfig(env),
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    }) as typeof fetch,
    sleep: async () => {
      sleeps += 1;
      if (sleeps >= stopAfterSleeps) controller.abort();
      return !controller.signal.aborted;
    },
    signal: controller.signal,
    log,
  };
  return { deps, calls, controller, log };
}

describe('pollLoop', () => {
  it('forwards each update to the webhook with the secret, then asks for the next offset', async () => {
    let round = 0;
    const { deps, calls, controller } = setup((url) => {
      if (url.endsWith('/getUpdates')) {
        round += 1;
        if (round === 1) return json({ ok: true, result: [{ update_id: 10, message: {} }, { update_id: 11 }] });
        controller.abort();
        return json({ ok: true, result: [] });
      }
      return json({ ok: true });
    });
    const delivered = await pollLoop(deps);
    expect(delivered).toBe(2);
    const hooks = calls.filter((c) => c.url.endsWith('/telegram/webhook'));
    expect(hooks).toHaveLength(2);
    expect((hooks[0]!.init.headers as Record<string, string>)['X-Telegram-Bot-Api-Secret-Token']).toBe(env.TELEGRAM_WEBHOOK_SECRET);
    const second = calls.filter((c) => c.url.endsWith('/getUpdates'))[1]!;
    expect(JSON.parse(second.init.body as string).offset).toBe(12);
  });

  it('does not advance past an update the API failed to handle (500) and retries the same batch', async () => {
    let getCalls = 0;
    const { deps, calls } = setup((url) => {
      if (url.endsWith('/getUpdates')) {
        getCalls += 1;
        return json({ ok: true, result: [{ update_id: 7 }] });
      }
      return new Response(null, { status: 500 });
    });
    const delivered = await pollLoop(deps);
    expect(delivered).toBe(0);
    expect(getCalls).toBe(1);
    const get = calls.find((c) => c.url.endsWith('/getUpdates'))!;
    expect(JSON.parse(get.init.body as string).offset).toBeUndefined();
  });

  it('backs off when getUpdates fails, logging a fixed line without the token', async () => {
    const { deps, log } = setup(() => json({ ok: false, description: 'Conflict' }, 409));
    await pollLoop(deps);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).not.toContain(env.TELEGRAM_BOT_TOKEN);
  });

  it('skips malformed entries without delivering them', async () => {
    let round = 0;
    const { deps, calls, controller } = setup((url) => {
      if (url.endsWith('/getUpdates')) {
        round += 1;
        if (round === 1) return json({ ok: true, result: ['lixo', { sem_id: true }, { update_id: 3 }] });
        controller.abort();
        return json({ ok: true, result: [] });
      }
      return json({ ok: true });
    });
    expect(await pollLoop(deps)).toBe(1);
    expect(calls.filter((c) => c.url.endsWith('/telegram/webhook'))).toHaveLength(1);
  });
});
