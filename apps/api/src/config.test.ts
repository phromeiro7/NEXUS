import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' };

describe('loadConfig', () => {
  it('names every missing variable', () => {
    expect(() => loadConfig({})).toThrow(/SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY/);
  });
  it('names only the missing one', () => {
    expect(() => loadConfig({ SUPABASE_URL: 'http://x' })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
  it('treats empty strings as missing', () => {
    expect(() => loadConfig({ ...base, SUPABASE_URL: '' })).toThrow(/SUPABASE_URL/);
  });
  it('defaults port to 3001 and webOrigin to the panel at localhost:3000', () => {
    expect(loadConfig(base)).toEqual({
      supabaseUrl: 'http://x',
      serviceRoleKey: 'k',
      port: 3001,
      webOrigin: 'http://localhost:3000',
    });
  });
  it('reads WEB_ORIGIN, trimmed', () => {
    expect(loadConfig({ ...base, WEB_ORIGIN: '  https://painel.example.com ' }).webOrigin).toBe(
      'https://painel.example.com',
    );
  });
  it('normalizes WEB_ORIGIN with a trailing slash to the bare origin', () => {
    expect(loadConfig({ ...base, WEB_ORIGIN: 'https://painel.example.com/' }).webOrigin).toBe(
      'https://painel.example.com',
    );
  });
  it('drops a path from WEB_ORIGIN and keeps a non-default port', () => {
    expect(loadConfig({ ...base, WEB_ORIGIN: 'http://localhost:3000/painel' }).webOrigin).toBe(
      'http://localhost:3000',
    );
    expect(loadConfig({ ...base, WEB_ORIGIN: 'HTTPS://Painel.Example.com:8443/' }).webOrigin).toBe(
      'https://painel.example.com:8443',
    );
  });
  it.each(['not a url', 'localhost:3000', 'painel.example.com'])('rejects a WEB_ORIGIN %j that is not an absolute URL', (v) => {
    expect(() => loadConfig({ ...base, WEB_ORIGIN: v })).toThrow(/WEB_ORIGIN/);
  });
  it.each(['', '   '])('treats an empty WEB_ORIGIN %j as the default', (v) => {
    expect(loadConfig({ ...base, WEB_ORIGIN: v }).webOrigin).toBe('http://localhost:3000');
  });
  it('parses PORT as integer', () => {
    expect(loadConfig({ ...base, PORT: '8080' }).port).toBe(8080);
  });
  it.each(['abc', '80.5', '0', '-1', '70000', ''])('rejects invalid PORT %j', (p) => {
    expect(() => loadConfig({ ...base, PORT: p })).toThrow(/PORT/);
  });
  it('never puts the key in an error message', () => {
    expect.assertions(1);
    try {
      loadConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: 'segredo-123', PORT: 'x' });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('segredo-123');
    }
  });
});
