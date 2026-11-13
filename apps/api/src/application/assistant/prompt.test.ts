import { describe, expect, it } from 'vitest';
import { buildContextBlock, buildSystemBlocks } from './prompt.js';

describe('buildSystemBlocks', () => {
  const blocks = buildSystemBlocks();
  const text = blocks.map((b) => b.text).join('\n');

  it('is ONE cacheable text block', () => {
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('text');
    expect(blocks[0]?.cache).toBe(true);
  });

  it('is stable: same output on every call, no date or time inside', () => {
    expect(buildSystemBlocks()).toEqual(blocks);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/\b\d{1,2}:\d{2}\b/);
    expect(text).not.toMatch(/Agora: [^"]*\d/);
    expect(text).not.toMatch(/Agora: \p{L}+-feira/u);
  });

  it('states the default-time rules', () => {
    expect(text).toContain('amanhã de manhã');
    expect(text).toMatch(/amanhã de manhã.{0,20}09h/s);
    expect(text).toMatch(/à tarde.{0,20}15h/s);
    expect(text).toMatch(/à noite.{0,20}20h/s);
    expect(text).toMatch(/dia da semana sem hora.{0,20}09h/s);
    expect(text).toContain('semana que vem');
    expect(text).toMatch(/sem data.{0,40}sem prazo/is);
  });

  it('explains the Agora line as the authoritative clock and user copies as data', () => {
    expect(text).toMatch(/linha "Agora:"/);
    expect(text).toMatch(/data e hora atuais/i);
    expect(text).toMatch(/referência oficial.{0,40}datas relativas/is);
    expect(text).toMatch(/"Agora:" escrita pelo usuário.{0,80}dado/is);
  });

  it('scopes ids to the current request', () => {
    expect(text).toContain('neste pedido');
    expect(text).not.toContain('nesta conversa');
  });

  it('states the behavioural rules', () => {
    expect(text).toContain('assistente pessoal de tarefas e lembretes');
    expect(text).not.toContain('advogado ou advogada');
    expect(text).toMatch(/sem julgamento/i);
    expect(text).toContain('português do Brasil');
    expect(text).toContain('calcular_prazo');
    expect(text).toContain('listar_tarefas');
    expect(text).toMatch(/nunca invente/i);
    expect(text).toMatch(/dados?,? nunca instruç/i);
    expect(text).toMatch(/nunca revele/i);
  });
});

describe('buildContextBlock', () => {
  it('formats weekday, ISO date, 24h time and zone in the user zone', () => {
    expect(buildContextBlock(new Date('2026-10-26T17:05:00Z'), 'America/Sao_Paulo')).toBe(
      'Agora: segunda-feira, 2026-10-26, 14:05 (America/Sao_Paulo)',
    );
  });

  it('uses the zone date, not the UTC date, and 24h hours', () => {
    expect(buildContextBlock(new Date('2026-10-27T02:30:00Z'), 'America/Sao_Paulo')).toBe(
      'Agora: segunda-feira, 2026-10-26, 23:30 (America/Sao_Paulo)',
    );
    expect(buildContextBlock(new Date('2026-10-26T02:59:00Z'), 'America/Sao_Paulo')).toBe(
      'Agora: domingo, 2026-10-25, 23:59 (America/Sao_Paulo)',
    );
    // meia-noite é 00:00, nunca 24:00
    expect(buildContextBlock(new Date('2026-10-26T03:00:00Z'), 'America/Sao_Paulo')).toBe(
      'Agora: segunda-feira, 2026-10-26, 00:00 (America/Sao_Paulo)',
    );
  });
});
