import { describe, expect, it } from 'vitest';
import { createTelegramClient } from './telegram-client.js';

const TOKEN = 'TEST_TOKEN_123';

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, impl };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createTelegramClient.sendMessage', () => {
  it('posts exactly { chat_id, text } to the sendMessage URL, without parse_mode', async () => {
    const f = fakeFetch(() => json(200, { ok: true, result: { message_id: 42 } }));
    const client = createTelegramClient({ token: TOKEN, fetch: f.impl });
    const result = await client.sendMessage(123456, 'Olá <b>mundo</b>');
    expect(result).toEqual({ ok: true, messageId: 42 });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe('https://api.telegram.org/botTEST_TOKEN_123/sendMessage');
    expect(f.calls[0]!.init.method).toBe('POST');
    expect(new Headers(f.calls[0]!.init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual({ chat_id: 123456, text: 'Olá <b>mundo</b>' });
    expect(Object.keys(JSON.parse(f.calls[0]!.init.body as string)).sort()).toEqual(['chat_id', 'text']);
    expect(f.calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps a text of exactly 4096 code points untouched', async () => {
    const f = fakeFetch(() => json(200, { ok: true, result: { message_id: 1 } }));
    const text = 'a'.repeat(4096);
    await createTelegramClient({ token: TOKEN, fetch: f.impl }).sendMessage(1, text);
    expect(JSON.parse(f.calls[0]!.init.body as string).text).toBe(text);
  });

  it('truncates to 4096 code points ending with an ellipsis, never splitting an emoji', async () => {
    const f = fakeFetch(() => json(200, { ok: true, result: { message_id: 1 } }));
    // 4094 'a' + emoji (1 code point, 2 UTF-16 units) at the cut + tail
    const text = `${'a'.repeat(4094)}😀😀😀`;
    await createTelegramClient({ token: TOKEN, fetch: f.impl }).sendMessage(1, text);
    const sent = JSON.parse(f.calls[0]!.init.body as string).text as string;
    expect(Array.from(sent)).toHaveLength(4096);
    expect(sent).toBe(`${'a'.repeat(4094)}😀…`);
  });

  it('truncates a plain overlong text to 4095 chars plus the ellipsis', async () => {
    const f = fakeFetch(() => json(200, { ok: true, result: { message_id: 1 } }));
    await createTelegramClient({ token: TOKEN, fetch: f.impl }).sendMessage(1, 'b'.repeat(5000));
    expect(JSON.parse(f.calls[0]!.init.body as string).text).toBe(`${'b'.repeat(4095)}…`);
  });

  it('classifies 403 as bot_bloqueado', async () => {
    const f = fakeFetch(() => json(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }));
    const r = await createTelegramClient({ token: TOKEN, fetch: f.impl }).sendMessage(1, 'x');
    expect(r).toEqual({ ok: false, error: { kind: 'permanent', reason: 'bot_bloqueado' } });
  });

  it('classifies 429 with retry_after as transient with retryAfterMs', async () => {
    const f = fakeFetch(() =>
      json(429, { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 7 } }),
    );
    const r = await createTelegramClient({ token: TOKEN, fetch: f.impl }).sendMessage(1, 'x');
    expect(r).toEqual({ ok: false, error: { kind: 'transient', retryAfterMs: 7000 } });
  });

  it('classifies 400 chat not found as chat_inexistente', async () => {
    const f = fakeFetch(() => json(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' }));
    const r = await createTelegramClient({ token: TOKEN, fetch: f.impl }).sendMessage(1, 'x');
    expect(r).toEqual({ ok: false, error: { kind: 'permanent', reason: 'chat_inexistente' } });
  });

  it('classifies 502 with a non-JSON body as transient', async () => {
    const f = fakeFetch(() => new Response('<html>Bad Gateway</html>', { status: 502 }));
    const r = await createTelegramClient({ token: TOKEN, fetch: f.impl }).sendMessage(1, 'x');
    expect(r).toEqual({ ok: false, error: { kind: 'transient' } });
  });

  it('classifies 401 as permanent outro', async () => {
    const f = fakeFetch(() => json(401, { ok: false, error_code: 401, description: 'Unauthorized' }));
    const r = await createTelegramClient({ token: TOKEN, fetch: f.impl }).sendMessage(1, 'x');
    expect(r).toEqual({ ok: false, error: { kind: 'permanent', reason: 'outro' } });
  });

  it('treats a network failure as transient (status 0), without throwing', async () => {
    const f = fakeFetch(() => {
      throw new TypeError(`fetch failed: https://api.telegram.org/bot${TOKEN}/sendMessage`);
    });
    const r = await createTelegramClient({ token: TOKEN, fetch: f.impl }).sendMessage(1, 'x');
    expect(r).toEqual({ ok: false, error: { kind: 'transient' } });
  });

  it('treats an abort/timeout as transient', async () => {
    const f = fakeFetch(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          (call.init.signal as AbortSignal).addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted', 'TimeoutError')),
          );
        }),
    );
    const r = await createTelegramClient({ token: TOKEN, fetch: f.impl, timeoutMs: 20 }).sendMessage(1, 'x');
    expect(r).toEqual({ ok: false, error: { kind: 'transient' } });
  });

  it('treats a 200 with ok:false as an error using body.error_code', async () => {
    const f = fakeFetch(() => json(200, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked' }));
    const r = await createTelegramClient({ token: TOKEN, fetch: f.impl }).sendMessage(1, 'x');
    expect(r).toEqual({ ok: false, error: { kind: 'permanent', reason: 'bot_bloqueado' } });
  });

  it('treats a 200 with ok:false and no error_code as permanent outro', async () => {
    const f = fakeFetch(() => json(200, { ok: false }));
    const r = await createTelegramClient({ token: TOKEN, fetch: f.impl }).sendMessage(1, 'x');
    expect(r).toEqual({ ok: false, error: { kind: 'permanent', reason: 'outro' } });
  });

  it('treats a 200 with a non-JSON body or without message_id as permanent outro', async () => {
    const a = fakeFetch(() => new Response('garbage', { status: 200 }));
    expect(await createTelegramClient({ token: TOKEN, fetch: a.impl }).sendMessage(1, 'x')).toEqual({
      ok: false,
      error: { kind: 'permanent', reason: 'outro' },
    });
    const b = fakeFetch(() => json(200, { ok: true, result: {} }));
    expect(await createTelegramClient({ token: TOKEN, fetch: b.impl }).sendMessage(1, 'x')).toEqual({
      ok: false,
      error: { kind: 'permanent', reason: 'outro' },
    });
  });

  it('never exposes the token, the text or the response body in thrown errors or console output', async () => {
    const SECRET_TEXT = 'TEXTO_SECRETO_DO_CLIENTE';
    const logged: string[] = [];
    const orig = { log: console.log, error: console.error, warn: console.warn };
    console.log = console.error = console.warn = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
    const cases: Array<() => Response | Promise<Response>> = [
      () => json(403, { ok: false, description: `leak ${TOKEN} ${SECRET_TEXT}` }),
      () => json(500, { description: `leak ${TOKEN}` }),
      () => new Response(`leak ${TOKEN} ${SECRET_TEXT}`, { status: 502 }),
      () => {
        throw new TypeError(`failed ${TOKEN}`);
      },
      () => json(200, { ok: false, error_code: 400, description: `leak ${TOKEN}` }),
      () => new Response(`leak ${TOKEN}`, { status: 200 }),
    ];
    try {
      for (const respond of cases) {
        const f = fakeFetch(respond);
        const client = createTelegramClient({ token: TOKEN, fetch: f.impl });
        let outcome: unknown;
        try {
          outcome = await client.sendMessage(1, SECRET_TEXT);
        } catch (e) {
          outcome = e;
        }
        const dump = outcome instanceof Error ? `${outcome.message}${outcome.stack ?? ''}` : JSON.stringify(outcome);
        expect(dump).not.toContain(TOKEN);
        expect(dump).not.toContain(SECRET_TEXT);
      }
    } finally {
      Object.assign(console, orig);
    }
    expect(logged.join('\n')).not.toContain(TOKEN);
    expect(logged.join('\n')).not.toContain(SECRET_TEXT);
  });
});
