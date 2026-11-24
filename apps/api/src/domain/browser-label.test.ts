import { describe, expect, it } from 'vitest';
import { describeBrowser } from './browser-label.js';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const EDGE_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0';
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1';

describe('describeBrowser', () => {
  it('descreve navegador e sistema', () => {
    expect(describeBrowser(CHROME_MAC)).toBe('Chrome em macOS');
    expect(describeBrowser(SAFARI_MAC)).toBe('Safari em macOS');
    expect(describeBrowser(EDGE_WIN)).toBe('Edge em Windows');
    expect(describeBrowser(FIREFOX_LINUX)).toBe('Firefox em Linux');
    expect(describeBrowser(CHROME_IOS)).toBe('Chrome em iOS');
  });
  it('sem informação útil devolve um nome genérico', () => {
    expect(describeBrowser(undefined)).toBe('Navegador');
    expect(describeBrowser('')).toBe('Navegador');
    expect(describeBrowser('curl/8.4.0')).toBe('Navegador');
  });
  it('só o sistema ou só o navegador', () => {
    expect(describeBrowser('Mozilla/5.0 (Windows NT 10.0)')).toBe('Navegador em Windows');
    expect(describeBrowser('Firefox/127.0')).toBe('Firefox');
  });
  it('não deixa o texto crescer', () => {
    expect(describeBrowser('x'.repeat(100_000)).length).toBeLessThanOrEqual(60);
  });
});
