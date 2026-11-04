import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTickRequest, formatTickOutput, main } from './reminders-tick.js';

const SECRET = 'TEST_SECRET_123';

afterEach(() => vi.restoreAllMocks());

describe('buildTickRequest', () => {
  it('requires INTERNAL_SECRET and names the variable', () => {
    expect(() => buildTickRequest({})).toThrow('Variável de ambiente ausente: INTERNAL_SECRET');
    expect(() => buildTickRequest({ INTERNAL_SECRET: '   ' })).toThrow('INTERNAL_SECRET');
  });

  it('defaults to localhost:3001, sends the secret in the header with POST and refuses redirects', () => {
    expect(buildTickRequest({ INTERNAL_SECRET: SECRET })).toEqual({
      url: 'http://localhost:3001/internal/reminders/run',
      init: { method: 'POST', headers: { 'X-Internal-Secret': SECRET }, redirect: 'error' },
    });
  });

  it('uses REMINDERS_URL and drops trailing slashes; empty means default', () => {
    expect(buildTickRequest({ INTERNAL_SECRET: 's', REMINDERS_URL: 'https://api.example.test//' }).url).toBe(
      'https://api.example.test/internal/reminders/run',
    );
    expect(buildTickRequest({ INTERNAL_SECRET: 's', REMINDERS_URL: '' }).url).toBe(
      'http://localhost:3001/internal/reminders/run',
    );
  });

  it.each(['http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001'])(
    'allows plain http for the loopback host %s',
    (REMINDERS_URL) => {
      expect(buildTickRequest({ INTERNAL_SECRET: 's', REMINDERS_URL }).url).toContain('/internal/reminders/run');
    },
  );

  it.each(['http://example.com', 'http://api.example.test:3001', 'http://localhost.evil.test', 'http://10.0.0.5'])(
    'refuses plain http for the non-loopback host %s, naming the variable and never the secret',
    (REMINDERS_URL) => {
      let message = '';
      try {
        buildTickRequest({ INTERNAL_SECRET: SECRET, REMINDERS_URL });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain('REMINDERS_URL');
      expect(message).not.toContain(SECRET);
    },
  );

  it.each(['not a url', 'ftp://example.com', 'localhost:3001'])('refuses the invalid REMINDERS_URL %s', (REMINDERS_URL) => {
    expect(() => buildTickRequest({ INTERNAL_SECRET: SECRET, REMINDERS_URL })).toThrow('REMINDERS_URL');
  });
});

describe('formatTickOutput', () => {
  const full = {
    reminders: { sent: 1, retried: 2, failed: 3, cancelled: 4, recovered: 5, paused: 6, leaseLost: 7, deferred: 8 },
    briefings: { sent: 1, skippedEmpty: 2, retried: 3, failed: 4, paused: 5, deferred: 6 },
    eventsRecovered: { recovered: 1, failed: 2 },
    purged: { chatMessages: 4, linkCodes: 5, modelCalls: 6 },
  };

  it('on 200 prints the status and the compact counts only', () => {
    expect(formatTickOutput(200, JSON.stringify(full))).toBe(`HTTP 200\n${JSON.stringify(full)}`);
  });

  it('on 200 drops unknown keys and non-numeric values (an echoed secret is never printed)', () => {
    const body = JSON.stringify({
      ...full,
      echo: SECRET,
      reminders: { ...full.reminders, sent: SECRET, extra: 9 },
      purged: { ...full.purged, token: SECRET },
    });
    const out = formatTickOutput(200, body);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain('extra');
    expect(out).toBe(
      `HTTP 200\n${JSON.stringify({
        reminders: { retried: 2, failed: 3, cancelled: 4, recovered: 5, paused: 6, leaseLost: 7, deferred: 8 },
        briefings: full.briefings,
        eventsRecovered: full.eventsRecovered,
        purged: full.purged,
      })}`,
    );
  });

  it('on 200 with a non-JSON body prints no body', () => {
    expect(formatTickOutput(200, `<html>${SECRET}</html>`)).toBe('HTTP 200\n(sem JSON)');
  });

  it.each(['nao_autenticado', 'agendador_desabilitado'])('on non-200 prints the status and the known error code %s', (code) => {
    expect(formatTickOutput(401, JSON.stringify({ error: code }))).toBe(`HTTP 401\n${code}`);
  });

  it('on non-200 prints only the status for an unknown code, extra fields or a non-JSON body', () => {
    expect(formatTickOutput(502, `<html>${SECRET} bad gateway</html>`)).toBe('HTTP 502');
    expect(formatTickOutput(500, JSON.stringify({ error: SECRET }))).toBe('HTTP 500');
    expect(formatTickOutput(401, JSON.stringify({ error: 'nao_autenticado', echo: SECRET }))).toBe('HTTP 401\nnao_autenticado');
    expect(formatTickOutput(404, JSON.stringify({ reminders: { sent: 1 } }))).toBe('HTTP 404');
  });
});

describe('formatTickOutput chat captures', () => {
  it('prints the Telegram login and QR login purge counts when the API reports them', () => {
    expect(formatTickOutput(200, JSON.stringify({ purged: { chatMessages: 0, telegramAuth: 5, qrLogin: 6 } }))).toBe(
      'HTTP 200\n{"purged":{"chatMessages":0,"telegramAuth":5,"qrLogin":6}}',
    );
  });

  it('prints the chatCaptures purge count when the API reports it', () => {
    expect(formatTickOutput(200, JSON.stringify({ purged: { chatMessages: 1, linkCodes: 2, modelCalls: 3, chatCaptures: 4 } }))).toBe(
      'HTTP 200\n{"purged":{"chatMessages":1,"linkCodes":2,"modelCalls":3,"chatCaptures":4}}',
    );
  });
});

describe('main', () => {
  function capture() {
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((m: string) => void out.push(String(m)));
    vi.spyOn(console, 'error').mockImplementation((m: string) => void out.push(String(m)));
    return out;
  }

  it('exits 1 without any request when INTERNAL_SECRET is missing', async () => {
    const out = capture();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await main({})).toBe(1);
    expect(out).toEqual(['Variável de ambiente ausente: INTERNAL_SECRET']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses http://example.com without any fetch call', async () => {
    const out = capture();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await main({ INTERNAL_SECRET: SECRET, REMINDERS_URL: 'http://example.com' })).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.join('\n')).toContain('REMINDERS_URL');
    expect(out.join('\n')).not.toContain(SECRET);
  });

  it('calls fetch with redirect error, exits 0 on 200 and prints only status and counts', async () => {
    const out = capture();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ purged: { chatMessages: 1, linkCodes: 2, modelCalls: 3 } }), { status: 200 }));
    expect(await main({ INTERNAL_SECRET: SECRET, REMINDERS_URL: 'http://localhost:3001' })).toBe(0);
    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:3001/internal/reminders/run', {
      method: 'POST',
      headers: { 'X-Internal-Secret': SECRET },
      redirect: 'error',
    });
    expect(out).toEqual(['HTTP 200\n{"purged":{"chatMessages":1,"linkCodes":2,"modelCalls":3}}']);
  });

  it('a redirect (fetch throws) exits 1 and prints neither the secret nor the Location', async () => {
    const out = capture();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError(`redirect to https://evil.test/${SECRET}`));
    expect(await main({ INTERNAL_SECRET: SECRET })).toBe(1);
    expect(out.join('\n')).not.toContain(SECRET);
    expect(out.join('\n')).not.toContain('evil');
  });

  it('a redirect response (3xx) exits 1 and prints only the status', async () => {
    const out = capture();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(SECRET, { status: 302, headers: { Location: `https://evil.test/${SECRET}` } }),
    );
    expect(await main({ INTERNAL_SECRET: SECRET })).toBe(1);
    expect(out).toEqual(['HTTP 302']);
  });

  it('a non-200 echoing the secret exits 1 and never prints it', async () => {
    const out = capture();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: SECRET, echo: SECRET }), { status: 400 }));
    expect(await main({ INTERNAL_SECRET: SECRET })).toBe(1);
    expect(out.join('\n')).not.toContain(SECRET);
  });
});
