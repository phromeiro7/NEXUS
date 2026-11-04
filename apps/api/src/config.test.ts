import { readFileSync } from 'node:fs';
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
      assistantModel: 'claude-haiku-5-5',
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
  it('starts without an Anthropic key and defaults the assistant model', () => {
    const c = loadConfig(base);
    expect(c.anthropicApiKey).toBeUndefined();
    expect(c.assistantModel).toBe('claude-haiku-5-5');
  });
  it('treats an empty ANTHROPIC_API_KEY as absent and reads a set one', () => {
    expect(loadConfig({ ...base, ANTHROPIC_API_KEY: '' }).anthropicApiKey).toBeUndefined();
    expect(loadConfig({ ...base, ANTHROPIC_API_KEY: 'chave-teste' }).anthropicApiKey).toBe('chave-teste');
  });
  it('overrides the assistant model with ASSISTANT_MODEL, empty means default', () => {
    expect(loadConfig({ ...base, ASSISTANT_MODEL: ' outro-modelo ' }).assistantModel).toBe('outro-modelo');
    expect(loadConfig({ ...base, ASSISTANT_MODEL: '' }).assistantModel).toBe('claude-haiku-5-5');
  });
  it('lists the assistant variable names (no values) in .env.example', () => {
    const text = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
    expect(text).toMatch(/^ANTHROPIC_API_KEY=$/m);
    expect(text).toMatch(/^ASSISTANT_MODEL=$/m);
  });
  it('starts without any Telegram or internal setting, all undefined and absent from the object', () => {
    const c = loadConfig(base);
    expect(c.telegramBotToken).toBeUndefined();
    expect(c.telegramBotUsername).toBeUndefined();
    expect(c.telegramWebhookSecret).toBeUndefined();
    expect(c.internalSecret).toBeUndefined();
    expect(Object.keys(c).sort()).toEqual(
      ['assistantModel', 'port', 'serviceRoleKey', 'supabaseUrl', 'webOrigin'].sort(),
    );
  });
  it('treats blank Telegram and internal values as absent', () => {
    const c = loadConfig({
      ...base,
      TELEGRAM_BOT_TOKEN: '  ',
      TELEGRAM_BOT_USERNAME: '',
      TELEGRAM_WEBHOOK_SECRET: ' ',
      INTERNAL_SECRET: '',
    });
    expect(c.telegramBotToken).toBeUndefined();
    expect(c.telegramBotUsername).toBeUndefined();
    expect(c.telegramWebhookSecret).toBeUndefined();
    expect(c.internalSecret).toBeUndefined();
  });
  it('reads the four values, trimmed', () => {
    const c = loadConfig({
      ...base,
      TELEGRAM_BOT_TOKEN: ' TEST_TOKEN_123 ',
      TELEGRAM_BOT_USERNAME: ' meu_bot ',
      TELEGRAM_WEBHOOK_SECRET: ' abc-DEF_123-abcdef ',
      INTERNAL_SECRET: ' interno-teste-1234 ',
    });
    expect(c.telegramBotToken).toBe('TEST_TOKEN_123');
    expect(c.telegramBotUsername).toBe('meu_bot');
    expect(c.telegramWebhookSecret).toBe('abc-DEF_123-abcdef');
    expect(c.internalSecret).toBe('interno-teste-1234');
  });
  it.each(['com espaço', 'acentuação', 'a/b', 'x'.repeat(257), 'a+b'])(
    'rejects an invalid TELEGRAM_WEBHOOK_SECRET %j naming only the variable',
    (v) => {
      expect.assertions(3);
      try {
        loadConfig({ ...base, TELEGRAM_WEBHOOK_SECRET: v });
      } catch (e) {
        const message = (e as Error).message;
        expect(message).toMatch(/TELEGRAM_WEBHOOK_SECRET/);
        expect(message).not.toContain(v);
        expect(message).not.toContain('SUPABASE');
      }
    },
  );
  it('accepts a TELEGRAM_WEBHOOK_SECRET of exactly 256 valid characters', () => {
    const secret = 'a'.repeat(256);
    expect(loadConfig({ ...base, TELEGRAM_WEBHOOK_SECRET: secret }).telegramWebhookSecret).toBe(secret);
  });
  it.each([
    ['TELEGRAM_WEBHOOK_SECRET', 'a'.repeat(15)],
    ['INTERNAL_SECRET', 'b'.repeat(15)],
  ])('rejects a short %s naming only the variable', (name, v) => {
    expect.assertions(3);
    try {
      loadConfig({ ...base, [name as string]: v });
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain(name);
      expect(message).not.toContain(v);
      expect(message).toMatch(/16/);
    }
  });
  it('accepts secrets of exactly 16 characters', () => {
    const c = loadConfig({ ...base, TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(16), INTERNAL_SECRET: 'b'.repeat(16) });
    expect(c.telegramWebhookSecret).toHaveLength(16);
    expect(c.internalSecret).toHaveLength(16);
  });
  it.each(['ab', 'com-hifen', '@meu_bot', 'x'.repeat(65), 'bot com espaço'])(
    'rejects an invalid TELEGRAM_BOT_USERNAME %j naming only the variable',
    (v) => {
      expect.assertions(2);
      try {
        loadConfig({ ...base, TELEGRAM_BOT_USERNAME: v });
      } catch (e) {
        expect((e as Error).message).toMatch(/TELEGRAM_BOT_USERNAME/);
        expect((e as Error).message).not.toContain(v);
      }
    },
  );
  it('accepts usernames of 3 and 64 valid characters', () => {
    expect(loadConfig({ ...base, TELEGRAM_BOT_USERNAME: 'abc' }).telegramBotUsername).toBe('abc');
    const long = 'A_1'.repeat(21) + 'x';
    expect(long).toHaveLength(64);
    expect(loadConfig({ ...base, TELEGRAM_BOT_USERNAME: long }).telegramBotUsername).toBe(long);
  });
  it('never echoes the token or the internal secret in any error message', () => {
    expect.assertions(2);
    try {
      loadConfig({
        ...base,
        TELEGRAM_BOT_TOKEN: 'TOKEN_SECRETO_9',
        INTERNAL_SECRET: 'INTERNO_SECRETO_9',
        TELEGRAM_WEBHOOK_SECRET: 'inválido!',
      });
    } catch (e) {
      expect((e as Error).message).not.toContain('TOKEN_SECRETO_9');
      expect((e as Error).message).not.toContain('INTERNO_SECRETO_9');
    }
  });
  it('lists the Telegram and internal variable names (no values) in .env.example', () => {
    const text = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
    for (const name of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET', 'INTERNAL_SECRET']) {
      expect(text).toMatch(new RegExp(`^${name}=$`, 'm'));
    }
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

describe('loadConfig MINI_APP_URL', () => {
  it('keeps only the https origin', () => {
    expect(loadConfig({ ...base, MINI_APP_URL: 'https://nexus.example.com/mini/' }).miniAppUrl).toBe('https://nexus.example.com');
  });
  it('is optional, and empty means absent', () => {
    expect(loadConfig(base).miniAppUrl).toBeUndefined();
    expect(loadConfig({ ...base, MINI_APP_URL: '  ' }).miniAppUrl).toBeUndefined();
  });
  it.each(['http://nexus.example.com', 'nexus.example.com', 'ftp://x'])('rejects %s and names the variable', (value) => {
    expect(() => loadConfig({ ...base, MINI_APP_URL: value })).toThrow('MINI_APP_URL');
  });
});
