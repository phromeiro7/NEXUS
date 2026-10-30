import { describe, expect, it, vi } from 'vitest';
import { buildTickRequest, formatTickOutput, main } from './reminders-tick.js';

describe('buildTickRequest', () => {
  it('requires INTERNAL_SECRET and names the variable', () => {
    expect(() => buildTickRequest({})).toThrow('Variável de ambiente ausente: INTERNAL_SECRET');
    expect(() => buildTickRequest({ INTERNAL_SECRET: '   ' })).toThrow('INTERNAL_SECRET');
  });

  it('defaults to localhost:3001 and sends the secret in the header with POST', () => {
    expect(buildTickRequest({ INTERNAL_SECRET: 'TEST_SECRET_123' })).toEqual({
      url: 'http://localhost:3001/internal/reminders/run',
      init: { method: 'POST', headers: { 'X-Internal-Secret': 'TEST_SECRET_123' } },
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
});

describe('formatTickOutput', () => {
  it('prints the status and the compact counts JSON only', () => {
    expect(formatTickOutput(200, '{ "reminders": { "sent": 1 } }')).toBe('HTTP 200\n{"reminders":{"sent":1}}');
  });

  it('never echoes a non-JSON body', () => {
    expect(formatTickOutput(502, '<html>TEST_SECRET_123 bad gateway</html>')).toBe('HTTP 502\n(sem JSON)');
  });
});

describe('main', () => {
  it('exits 1 without any request when INTERNAL_SECRET is missing', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((m: string) => void errors.push(m));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await main({})).toBe(1);
    expect(errors).toEqual(['Variável de ambiente ausente: INTERNAL_SECRET']);
    expect(fetchSpy).not.toHaveBeenCalled();
    spy.mockRestore();
    fetchSpy.mockRestore();
  });
});
