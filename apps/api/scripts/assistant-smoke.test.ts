import { describe, expect, it, vi } from 'vitest';
import type { AssistantModel, ModelStep } from '../src/application/ports.js';
import {
  buildSmokeCases,
  estimateCost,
  formatReport,
  main,
  maxCalls,
  MAX_STEPS,
  type SmokeResult,
  upperBoundCost,
} from './assistant-smoke.js';

const FAKE_KEY = 'sk-ant-FAKE-KEY-0123456789-do-not-leak';

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    deps: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) },
    all: () => [...out, ...err].join('\n'),
  };
}

const textStep = (text: string): ModelStep => ({
  stopReason: 'end_turn',
  blocks: [{ type: 'text', text }],
  usage: { inputTokens: 2000, outputTokens: 50, cacheReadTokens: 0 },
});

describe('estimateCost', () => {
  it('1M entrada + 1M saída = US$ 0,60', () => {
    expect(estimateCost({ inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0 })).toBeCloseTo(0.6, 10);
  });
  it('leitura de cache custa 10% do preço da entrada', () => {
    expect(estimateCost({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.01, 10);
  });
  it('soma as três parcelas', () => {
    expect(estimateCost({ inputTokens: 2_000_000, outputTokens: 1_000_000, cacheReadTokens: 10_000_000 })).toBeCloseTo(
      0.2 + 0.5 + 0.1,
      10,
    );
  });
});

describe('buildSmokeCases / maxCalls', () => {
  it('tem as ~10 frases pedidas, cada uma com externalId próprio', () => {
    const cases = buildSmokeCases();
    expect(cases.length).toBe(10);
    expect(new Set(cases.map((c) => c.externalId)).size).toBe(cases.length);
    const all = cases.map((c) => c.phrase).join('\n');
    for (const needle of ['amanhã de manhã', 'sexta', 'semana que vem', '30/02', '15 dias úteis', '16h', 'vence essa semana', 'ignore as regras']) {
      expect(all).toContain(needle);
    }
  });
  it('maxCalls = frases x passos máximos', () => {
    expect(maxCalls(buildSmokeCases())).toBe(10 * MAX_STEPS);
    expect(MAX_STEPS).toBe(4);
  });
  it('teto de custo é positivo e acima de uma execução típica', () => {
    expect(upperBoundCost(40)).toBeGreaterThan(0);
  });
});

const results: SmokeResult[] = [
  {
    phrase: 'Anotar reunião amanhã de manhã',
    tools: ['criar_tarefa'],
    tasks: [{ title: 'Reunião fictícia', dueDate: '2026-10-27', dueTime: '09:00' }],
    reply: 'Anotei a reunião.',
    usage: { inputTokens: 2000, outputTokens: 100, cacheReadTokens: 1500 },
    calls: 2,
    ms: 1234,
  },
  {
    phrase: 'Outra frase',
    tools: [],
    tasks: [],
    reply: 'Qual data?',
    usage: { inputTokens: 1000, outputTokens: 20, cacheReadTokens: 0 },
    calls: 1,
    ms: 800,
    error: 'AssistantUnavailableError',
  },
];

describe('formatReport', () => {
  const report = formatReport(results, 'claude-haiku-5-5');
  it('traz o bloco por frase', () => {
    expect(report).toContain('Anotar reunião amanhã de manhã');
    expect(report).toContain('criar_tarefa');
    expect(report).toContain('Reunião fictícia');
    expect(report).toContain('2026-10-27');
    expect(report).toContain('09:00');
    expect(report).toContain('Anotei a reunião.');
    expect(report).toContain('1500');
    expect(report).toContain('1234');
    expect(report).toContain('AssistantUnavailableError');
  });
  it('traz a tabela-resumo e a estimativa de custo', () => {
    expect(report).toMatch(/\| *#/);
    expect(report).toContain('Total');
    expect(report).toContain('ESTIMATIVA DE CUSTO');
    const expected = estimateCost({ inputTokens: 3000, outputTokens: 120, cacheReadTokens: 1500 });
    expect(report).toContain(expected.toFixed(4));
  });
});

describe('main: portões de segurança', () => {
  it('recusa sem a chave, nomeando a variável, sem chamar o modelo nem criá-lo', async () => {
    const t = io();
    const createModel = vi.fn();
    const code = await main(['--yes'], {}, { ...t.deps, createModel });
    expect(code).not.toBe(0);
    expect(t.err.join('\n')).toContain('ANTHROPIC_API_KEY');
    expect(createModel).not.toHaveBeenCalled();
  });

  it('sem --yes imprime máximo de chamadas e estimativa, sai com 0 e não chama o modelo', async () => {
    const t = io();
    const step = vi.fn();
    const createModel = vi.fn((): AssistantModel => ({ step }));
    const code = await main([], { ANTHROPIC_API_KEY: FAKE_KEY }, { ...t.deps, createModel });
    expect(code).toBe(0);
    const text = t.out.join('\n');
    expect(text).toContain(String(10 * MAX_STEPS));
    expect(text).toContain('--yes');
    expect(text).toMatch(/US\$ ?\d/);
    expect(step).not.toHaveBeenCalled();
    expect(createModel).not.toHaveBeenCalled();
    expect(t.all()).not.toContain(FAKE_KEY);
  });

  it('com --yes e modelo falso roda todas as frases e imprime o relatório sem a chave', async () => {
    const t = io();
    const step = vi.fn(async () => textStep('Resposta fictícia.'));
    const createModel = vi.fn((): AssistantModel => ({ step }));
    const code = await main(['--yes'], { ANTHROPIC_API_KEY: FAKE_KEY }, { ...t.deps, createModel });
    expect(code).toBe(0);
    expect(step).toHaveBeenCalledTimes(10);
    const text = t.out.join('\n');
    expect(text).toContain('Resposta fictícia.');
    expect(text).toContain('ESTIMATIVA DE CUSTO');
    expect(t.all()).not.toContain(FAKE_KEY);
    expect(createModel).toHaveBeenCalledWith(FAKE_KEY, 'claude-haiku-5-5');
  });

  it('usa ASSISTANT_MODEL quando definido', async () => {
    const t = io();
    const createModel = vi.fn((): AssistantModel => ({ step: async () => textStep('ok') }));
    await main(['--yes'], { ANTHROPIC_API_KEY: FAKE_KEY, ASSISTANT_MODEL: 'outro-modelo' }, { ...t.deps, createModel });
    expect(createModel).toHaveBeenCalledWith(FAKE_KEY, 'outro-modelo');
  });

  it('--out grava o relatório só quando pedido explicitamente, sem a chave', async () => {
    const t = io();
    const writeFile = vi.fn();
    const createModel = vi.fn((): AssistantModel => ({ step: async () => textStep('ok') }));
    await main(['--yes', '--out', 'rel.txt'], { ANTHROPIC_API_KEY: FAKE_KEY }, { ...t.deps, createModel, writeFile });
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, content] = writeFile.mock.calls[0] as unknown as [string, string];
    expect(path).toBe('rel.txt');
    expect(content).not.toContain(FAKE_KEY);

    const t2 = io();
    const writeFile2 = vi.fn();
    await main(['--yes'], { ANTHROPIC_API_KEY: FAKE_KEY }, { ...t2.deps, createModel, writeFile: writeFile2 });
    expect(writeFile2).not.toHaveBeenCalled();
  });

  it('erro do modelo em uma frase não derruba as outras nem vaza a chave', async () => {
    const t = io();
    let n = 0;
    const createModel = vi.fn(
      (): AssistantModel => ({
        step: async () => {
          n += 1;
          if (n === 1) throw new Error(`falha com ${FAKE_KEY}`);
          return textStep('ok');
        },
      }),
    );
    const code = await main(['--yes'], { ANTHROPIC_API_KEY: FAKE_KEY }, { ...t.deps, createModel });
    expect(code).toBe(0);
    expect(t.all()).not.toContain(FAKE_KEY);
    expect(t.out.join('\n')).toContain('Error');
  });
});
