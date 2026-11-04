import { describe, expect, it } from 'vitest';
import { BRIEFING_WINDOW_MINUTES, briefingLocalDate } from './briefing-window.js';

const SP = 'America/Sao_Paulo'; // UTC-3 o ano todo
const AKL = 'Pacific/Auckland'; // NZDT UTC+13 em out/2026
const at = (iso: string) => new Date(iso);

describe('briefingLocalDate', () => {
  it('a janela dura 4 horas', () => {
    expect(BRIEFING_WINDOW_MINUTES).toBe(240);
  });

  it('07:59 locais: fora; 08:00 locais: dentro e devolve a data local', () => {
    expect(briefingLocalDate(at('2026-10-26T10:59:00Z'), SP, '08:00')).toBeNull();
    expect(briefingLocalDate(at('2026-10-26T11:00:00Z'), SP, '08:00')).toBe('2026-10-26');
  });

  it('dentro da janela até 12:00 locais (inclusive); 12:01 já fora', () => {
    expect(briefingLocalDate(at('2026-10-26T14:59:00Z'), SP, '08:00')).toBe('2026-10-26');
    expect(briefingLocalDate(at('2026-10-26T15:00:00Z'), SP, '08:00')).toBe('2026-10-26');
    expect(briefingLocalDate(at('2026-10-26T15:01:00Z'), SP, '08:00')).toBeNull();
  });

  it('usuário em Auckland já no dia seguinte usa a data LOCAL', () => {
    // 2026-10-26T19:30Z = 2026-10-27 08:30 em Auckland (UTC+13)
    expect(briefingLocalDate(at('2026-10-26T19:30:00Z'), AKL, '08:00')).toBe('2026-10-27');
    // no mesmo instante em São Paulo são 16:30 de 26/10: fora da janela das 08:00
    expect(briefingLocalDate(at('2026-10-26T19:30:00Z'), SP, '08:00')).toBeNull();
  });

  it('janela que cruza a meia-noite local pertence à data local do briefingTime', () => {
    // 22:00 + 4 h = 02:00 do dia seguinte
    expect(briefingLocalDate(at('2026-10-27T00:59:00Z'), SP, '22:00')).toBeNull(); // 21:59 local
    expect(briefingLocalDate(at('2026-10-27T01:00:00Z'), SP, '22:00')).toBe('2026-10-26'); // 22:00 de 26/10
    expect(briefingLocalDate(at('2026-10-27T02:30:00Z'), SP, '22:00')).toBe('2026-10-26'); // 23:30
    // 00:30 de 27/10 local: ainda a janela do dia 26
    expect(briefingLocalDate(at('2026-10-27T03:30:00Z'), SP, '22:00')).toBe('2026-10-26');
    // 02:00 local exato: último minuto
    expect(briefingLocalDate(at('2026-10-27T05:00:00Z'), SP, '22:00')).toBe('2026-10-26');
    expect(briefingLocalDate(at('2026-10-27T05:01:00Z'), SP, '22:00')).toBeNull();
  });

  it('virada de mês na janela que cruza a meia-noite', () => {
    // 2026-11-01 00:30 em SP (03:30Z) com briefing 23:00 -> janela de 31/10
    expect(briefingLocalDate(at('2026-11-01T03:30:00Z'), SP, '23:00')).toBe('2026-10-31');
  });

  it('briefingTime 23:59 e 00:00 nas bordas do dia', () => {
    expect(briefingLocalDate(at('2026-10-27T02:59:00Z'), SP, '23:59')).toBe('2026-10-26');
    expect(briefingLocalDate(at('2026-10-26T03:00:00Z'), SP, '00:00')).toBe('2026-10-26');
    expect(briefingLocalDate(at('2026-10-26T07:00:00Z'), SP, '00:00')).toBe('2026-10-26'); // 04:00 local, inclusive
    expect(briefingLocalDate(at('2026-10-26T07:01:00Z'), SP, '00:00')).toBeNull();
  });

  it('aceita HH:mm:ss (coluna time do Postgres)', () => {
    expect(briefingLocalDate(at('2026-10-26T11:00:00Z'), SP, '08:00:00')).toBe('2026-10-26');
  });

  it('dia de horário de verão com a hora do briefing pulada não lança', () => {
    // New York 2026-03-08: 02:00 -> 03:00 (07:00Z). Briefing 02:30 não existe.
    expect(briefingLocalDate(at('2026-03-08T06:59:00Z'), 'America/New_York', '02:30')).toBeNull(); // 01:59
    expect(briefingLocalDate(at('2026-03-08T07:00:00Z'), 'America/New_York', '02:30')).toBe('2026-03-08'); // 03:00
  });

  it('dia de horário de verão com hora repetida não lança', () => {
    // New York 2026-11-01: 02:00 EDT -> 01:00 EST (06:00Z). Briefing 01:30 ocorre duas vezes.
    expect(() => briefingLocalDate(at('2026-11-01T05:30:00Z'), 'America/New_York', '01:30')).not.toThrow();
    expect(briefingLocalDate(at('2026-11-01T06:30:00Z'), 'America/New_York', '01:30')).toBe('2026-11-01');
  });

  it('fuso desconhecido ou briefingTime malformado lançam RangeError (quem chama pula a linha)', () => {
    const now = at('2026-10-26T11:00:00Z');
    expect(() => briefingLocalDate(now, 'Nowhere/Land', '08:00')).toThrow(RangeError);
    for (const bad of ['abc', '', '8:00', '25:00', '08:60', '08:00:99', '08']) {
      expect(() => briefingLocalDate(now, SP, bad), bad).toThrow(RangeError);
    }
  });

  it('nunca usa o fuso do servidor: mesmo resultado em qualquer TZ do processo', () => {
    expect(briefingLocalDate(at('2026-10-26T11:00:00Z'), SP, '08:00')).toBe('2026-10-26');
    expect(briefingLocalDate(at('2026-10-26T10:00:00Z'), 'UTC', '10:00')).toBe('2026-10-26');
  });
});
