import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './api';

type Call = { url: string; init: RequestInit };

function setup(
  respond: () => Response | Promise<Response> = () => Response.json({ userId: 'u1' }),
  token: string | null = 'tok',
) {
  const calls: Call[] = [];
  const fetchFake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  });
  const onUnauthorized = vi.fn();
  const getToken = vi.fn(async () => token);
  const client = createApiClient({
    baseUrl: 'http://api.test',
    getToken,
    onUnauthorized,
    fetch: fetchFake as unknown as typeof fetch,
  });
  return { client, calls, fetchFake, onUnauthorized, getToken };
}

function headersOf(call: Call): Headers {
  return new Headers(call.init.headers);
}

describe('createApiClient requests', () => {
  it('sends the bearer token and no Content-Type without a body', async () => {
    const { client, calls } = setup();
    await expect(client.me()).resolves.toEqual({ userId: 'u1' });
    expect(calls[0]!.url).toBe('http://api.test/me');
    expect(calls[0]!.init.method).toBe('GET');
    const h = headersOf(calls[0]!);
    expect(h.get('Authorization')).toBe('Bearer tok');
    expect(h.get('Content-Type')).toBeNull();
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it('sends Content-Type and a JSON body when there is a body', async () => {
    const { client, calls } = setup(() => Response.json({ id: 't1' }, { status: 201 }));
    await client.createTask({ title: 'Ligar', fatal: false });
    expect(calls[0]!.url).toBe('http://api.test/tasks');
    expect(calls[0]!.init.method).toBe('POST');
    expect(headersOf(calls[0]!).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      title: 'Ligar',
      fatal: false,
    });
  });

  it('serializes listTasks with comma-separated status and stable order', async () => {
    const { client, calls } = setup(() => Response.json([]));
    await client.listTasks({ withoutDate: true, status: ['pendente', 'em_andamento'] });
    expect(calls[0]!.url).toBe(
      'http://api.test/tasks?status=pendente%2Cem_andamento&withoutDate=true',
    );
  });

  it('serializes all listTasks fields in a fixed order', async () => {
    const { client, calls } = setup(() => Response.json([]));
    await client.listTasks({
      withoutDate: false,
      status: ['pendente'],
      to: '2026-11-30',
      from: '2026-11-01',
    });
    expect(calls[0]!.url).toBe(
      'http://api.test/tasks?from=2026-11-01&to=2026-11-30&status=pendente&withoutDate=false',
    );
  });

  it('omits the query string when empty', async () => {
    const { client, calls } = setup(() => Response.json([]));
    await client.listTasks({});
    expect(calls[0]!.url).toBe('http://api.test/tasks');
    await client.listTasks({ status: [] });
    expect(calls[1]!.url).toBe('http://api.test/tasks');
  });

  it('uses the right method and path for each endpoint', async () => {
    const { client, calls } = setup(() => Response.json({}));
    await client.getTask('a b');
    await client.updateTask('t1', { fatal: true });
    await client.getSettings();
    await client.updateSettings({ timezone: 'America/Sao_Paulo' });
    await client.getBriefing();
    expect(calls.map((c) => `${c.init.method} ${c.url.replace('http://api.test', '')}`)).toEqual([
      'GET /tasks/a%20b',
      'PATCH /tasks/t1',
      'GET /settings',
      'PATCH /settings',
      'GET /briefing',
    ]);
  });

  it('interpretCapture posts only the text', async () => {
    const result = { today: '2026-11-04', proposal: null };
    const { client, calls } = setup(() => Response.json(result));
    await expect(client.interpretCapture({ text: 'oi' })).resolves.toEqual(result);
    expect(calls[0]!.url).toBe('http://api.test/capture/interpret');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ text: 'oi' });
  });

  it('sendAssistantMessage posts text and clientMessageId only', async () => {
    const { client, calls } = setup(() => Response.json({ reply: 'ok', affectedTasks: [] }));
    const input = { text: 'oi', clientMessageId: '3f2b8c1e-5d4a-4b7e-9a10-2c6d8e4f1a77' };
    await expect(client.sendAssistantMessage(input)).resolves.toEqual({ reply: 'ok', affectedTasks: [] });
    expect(calls[0]!.url).toBe('http://api.test/assistant/message');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(input);
  });

  it('createLinkCode posts without a body and unlinkTelegram deletes with 204', async () => {
    const dto = { code: 'ABC123', deepLink: 'https://t.me/bot?start=ABC123', expiresAt: '2026-10-31T12:10:00.000Z' };
    const { client, calls } = setup(() => Response.json(dto));
    await expect(client.createLinkCode()).resolves.toEqual(dto);
    expect(calls[0]!.url).toBe('http://api.test/telegram/link-codes');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.body).toBeUndefined();
    expect(headersOf(calls[0]!).get('Content-Type')).toBeNull();

    const json = vi.fn(() => Promise.reject(new Error('no json')));
    const res = { ok: true, status: 204, json } as unknown as Response;
    const second = setup(() => res);
    await expect(second.client.unlinkTelegram()).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
    expect(second.calls[0]!.url).toBe('http://api.test/telegram/link');
    expect(second.calls[0]!.init.method).toBe('DELETE');
  });

  it('createLinkCode surfaces 503 telegram_nao_configurado as ApiError', async () => {
    const { client } = setup(() => Response.json({ error: 'telegram_nao_configurado' }, { status: 503 }));
    await expect(client.createLinkCode()).rejects.toMatchObject({ status: 503, code: 'telegram_nao_configurado' });
  });

  it('deleteTask handles 204 without reading JSON', async () => {
    const json = vi.fn(() => Promise.reject(new Error('no json')));
    const res = { ok: true, status: 204, json } as unknown as Response;
    const { client, calls } = setup(() => res);
    await expect(client.deleteTask('t1')).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
    expect(calls[0]!.init.method).toBe('DELETE');
    expect(calls[0]!.url).toBe('http://api.test/tasks/t1');
    expect(headersOf(calls[0]!).get('Content-Type')).toBeNull();
  });
});

describe('createApiClient errors', () => {
  it('turns a 4xx into ApiError with status, code and body', async () => {
    const body = { error: 'transicao_invalida', from: 'concluida', to: 'pendente' };
    const { client, onUnauthorized } = setup(() => Response.json(body, { status: 409 }));
    const err = await client.updateTask('t1', { status: 'pendente' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(409);
    expect(apiErr.code).toBe('transicao_invalida');
    expect(apiErr.body).toEqual(body);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('falls back to a generic code when the error body is not JSON', async () => {
    const { client } = setup(() => new Response('<html>', { status: 502 }));
    const err = (await client.me().catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.code).toBe('desconhecido');
  });

  it('calls onUnauthorized exactly once on 401 and throws ApiError', async () => {
    const { client, onUnauthorized } = setup(() =>
      Response.json({ error: 'nao_autenticado' }, { status: 401 }),
    );
    const err = (await client.me().catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe('nao_autenticado');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('with a null token calls onUnauthorized and does not make the request', async () => {
    const { client, fetchFake, onUnauthorized } = setup(undefined, null);
    const err = (await client.me().catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe('nao_autenticado');
    expect(fetchFake).not.toHaveBeenCalled();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('turns a network failure into ApiError status 0 code rede, without retrying', async () => {
    const { client, fetchFake, onUnauthorized } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    const err = (await client.me().catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.code).toBe('rede');
    expect(fetchFake).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe('createApiClient finance entries', () => {
  it('lists with a stable query string, and everything without filters', async () => {
    const { client, calls } = setup(() => Response.json([]));
    await client.listFinanceEntries();
    await client.listFinanceEntries({ status: 'a_pagar', to: '2026-11-30', from: '2026-11-01' });
    expect(calls[0]!.url).toBe('http://api.test/finance-entries');
    expect(calls[1]!.url).toBe('http://api.test/finance-entries?from=2026-11-01&to=2026-11-30&status=a_pagar');
  });

  it('creates, updates and deletes by id', async () => {
    const { client, calls } = setup(() => Response.json({ id: 'f1' }));
    await client.createFinanceEntry({
      id: 'f1',
      kind: 'gasto',
      description: 'Almoço',
      amountCents: 4200,
      category: null,
      dueDate: '2026-11-04',
      status: 'paga',
      reminderTime: null,
    });
    await client.updateFinanceEntry('f1', { status: 'paga' });
    expect(calls[0]!.url).toBe('http://api.test/finance-entries');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[1]!.url).toBe('http://api.test/finance-entries/f1');
    expect(calls[1]!.init.method).toBe('PATCH');
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ status: 'paga' });
  });

  it('delete resolves on 204', async () => {
    const { client, calls } = setup(() => new Response(null, { status: 204 }));
    await expect(client.deleteFinanceEntry('f1')).resolves.toBeUndefined();
    expect(calls[0]!.init.method).toBe('DELETE');
    expect(calls[0]!.url).toBe('http://api.test/finance-entries/f1');
  });
});
