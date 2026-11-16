import { FINANCE_MAX_CENTS, type IsoDate } from '@nexus/shared';
import { addDays, weekday } from './calendar.js';

/*
 * Interpretador de regras para mensagens de chat em português: "gastei 45 no mercado", "internet 119,90
 * vence dia 8", "reunião com a equipe sexta 9h30". Função pura: sem IA, sem relógio, sem rede. `today` é o dia local
 * do usuário (já no fuso dele).
 *
 * Regras de honestidade: nunca assume data ou horário que a pessoa não disse (tarefa sem data fica sem data;
 * "de manhã/tarde/noite" não vira horário); só o gasto e a entrada paga assumem "hoje", e o bot mostra isso
 * para a pessoa confirmar. Ambíguo (dois valores, duas datas, verbo de dinheiro sem valor) = `null`.
 *
 * O que deliberadamente NÃO cobre: "semana que vem", "daqui a 2 dias", "dia 10 do mês que vem", valores por
 * extenso ("cem reais"), parcelas, mais de um lançamento por mensagem, "15 mil" e moedas diferentes de R$.
 */

export type CaptureProposal =
  | {
      kind: 'gasto' | 'entrada' | 'conta';
      description: string;
      amountCents: number;
      category: string | null;
      /** gasto e entrada paga assumem hoje; conta e entrada a receber sem data ficam `null` (o bot pergunta). */
      date: IsoDate | null;
      time: string | null;
      status: 'paga' | 'a_pagar';
    }
  | { kind: 'tarefa'; title: string; date: IsoDate | null; time: string | null; vagueTime: boolean };

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 120;

const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

type Token = { raw: string; key: string };

type DateSpec =
  | { t: 'abs'; date: IsoDate }
  | { t: 'dom'; n: number }
  | { t: 'wd'; wd: number }
  | { t: 'dm'; d: number; m: number; y: number | null };

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

const MONEY_VERBS = new Set(['gastei', 'paguei', 'comprei', 'gastamos', 'pagamos']);
const INCOME_VERBS = new Set(['recebi', 'entrou', 'ganhei', 'caiu']);
const FUTURE_INCOME = new Set(['recebo', 'receberei', 'receber']);
const BILL_WORDS = new Set(['vence', 'vencimento', 'vencendo', 'boleto', 'fatura']);
const FILLER_WORDS = new Set(['reais', 'real', 'vou', 'vai', 'entrar', 'pagar']);
const PREPOSITIONS = new Set(['em', 'no', 'na', 'nos', 'nas', 'de', 'do', 'da', 'dos', 'das', 'com', 'para', 'pra', 'por', 'pelo', 'pela', 'a', 'o', 'as', 'os', 'e']);
const VAGUE_PARTS = new Set(['manha', 'tarde', 'noite', 'madrugada']);
const GREETINGS = new Set(['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'obrigado', 'obrigada', 'valeu', 'tudo bem', 'ok', 'certo', 'ajuda', 'help']);

const CATEGORY_WORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['Roupas', ['roupa', 'roupas', 'camisa', 'camiseta', 'sapato', 'tenis', 'calca', 'vestido', 'jaqueta', 'blusa']],
  ['Mercado', ['mercado', 'supermercado', 'mercadinho', 'feira', 'padaria', 'acougue', 'hortifruti', 'pao']],
  ['Transporte', ['uber', '99', 'taxi', 'onibus', 'metro', 'gasolina', 'combustivel', 'estacionamento', 'pedagio', 'passagem']],
  ['Lazer', ['cinema', 'bar', 'restaurante', 'almoco', 'jantar', 'lanche', 'ifood', 'cerveja', 'show', 'festa', 'pizza', 'cafe', 'balada', 'netflix', 'spotify']],
  ['Moradia', ['aluguel', 'condominio', 'luz', 'agua', 'internet', 'gas', 'iptu', 'energia']],
  ['Saúde', ['farmacia', 'remedio', 'medico', 'consulta', 'dentista', 'exame', 'saude']],
];

const INCOME_CATEGORY_WORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['Freela', ['freela', 'freelance', 'freelancer']],
  ['Salário', ['salario']],
];

const CATEGORY_KEYS = new Set(CATEGORY_WORDS.flatMap(([, words]) => words));

function categoryOf(keys: string[], table: ReadonlyArray<readonly [string, readonly string[]]>): string | null {
  for (const [label, words] of table) if (keys.some((k) => words.includes(k))) return label;
  return null;
}

// ----- datas -----

const isoOf = (y: number, m: number, d: number): IsoDate | null => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` as IsoDate;
};

const partsOf = (date: IsoDate): [number, number, number] => date.split('-').map(Number) as [number, number, number];

/** Primeiro mês (a partir do atual, para a frente ou para trás) em que o dia N existe e respeita o sentido. */
function dayOfMonth(today: IsoDate, n: number, direction: 'future' | 'past'): IsoDate | null {
  const [y, m] = partsOf(today);
  for (let step = 0; step < 14; step += 1) {
    const offset = direction === 'future' ? step : -step;
    const total = y * 12 + (m - 1) + offset;
    const iso = isoOf(Math.floor(total / 12), (total % 12) + 1, n);
    if (iso === null) continue;
    if (direction === 'future' ? iso >= today : iso <= today) return iso;
  }
  return null;
}

function resolveDate(spec: DateSpec, today: IsoDate, direction: 'future' | 'past'): IsoDate | null {
  switch (spec.t) {
    case 'abs':
      return spec.date;
    case 'dom':
      return dayOfMonth(today, spec.n, direction);
    case 'wd': {
      if (direction === 'future') {
        const diff = (spec.wd - weekday(today) + 7) % 7 || 7; // "sexta" numa sexta é a da semana seguinte
        return addDays(today, diff);
      }
      return addDays(today, -((weekday(today) - spec.wd + 7) % 7));
    }
    case 'dm': {
      const [y] = partsOf(today);
      if (spec.y !== null) return isoOf(spec.y, spec.m, spec.d);
      const years = direction === 'future' ? [y, y + 1] : [y, y - 1];
      for (const candidate of years) {
        const iso = isoOf(candidate, spec.m, spec.d);
        if (iso !== null && (direction === 'future' ? iso >= today : iso <= today)) return iso;
      }
      return null;
    }
  }
}

// ----- números -----

const NUMBER_RE = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/;

function centsOf(key: string): number | null {
  if (!NUMBER_RE.test(key)) return null;
  const [int = '', dec = ''] = key.split(',');
  const cents = Number(int.replace(/\./g, '')) * 100 + Number(dec.padEnd(2, '0') || '0');
  return Number.isSafeInteger(cents) ? cents : null;
}

type Amount = { index: number; cents: number | null; form: 'prefixed' | 'decimal' | 'bare' };

const timeText = (h: number, m: number): string => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/** Remove as palavras de ligação que sobram nas pontas ("em roupa" -> "roupa", "pra" solto no fim). */
function trimEdges(words: string[]): string[] {
  const out = [...words];
  while (out.length > 0 && PREPOSITIONS.has(fold(out[0]!))) out.shift();
  while (out.length > 0 && PREPOSITIONS.has(fold(out[out.length - 1]!))) out.pop();
  return out;
}

const REMINDER_PREFIX = /^(?:me\s+lembr[ae]r?\s+(?:de|para|pra)\s+|lembrar\s+(?:de|para|pra)\s+|lembrete\s+(?:de|para|pra)?\s*)/i;

export function interpretCapture(text: string, today: IsoDate): CaptureProposal | null {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return null;
  if (GREETINGS.has(fold(trimmed).replace(/[.,;:!?]+$/, ''))) return null;
  // Pergunta não é registro: quem responde é o assistente (ou a ajuda).
  if (trimmed.includes('?')) return null;

  const tokens: Token[] = trimmed.split(' ').map((raw) => ({ raw, key: fold(raw).replace(/[.,;:!?]+$/, '') }));
  const consumed = new Set<number>();
  const dates: DateSpec[] = [];
  const times: string[] = [];
  let vagueTime = false;

  const keyAt = (i: number): string => tokens[i]?.key ?? '';
  const free = (i: number): boolean => i < tokens.length && !consumed.has(i);
  const take = (...idx: number[]): void => idx.forEach((i) => consumed.add(i));

  for (let i = 0; i < tokens.length; i += 1) {
    if (consumed.has(i)) continue;
    const k = keyAt(i);

    if (k === 'depois' && keyAt(i + 1) === 'de' && keyAt(i + 2) === 'amanha') {
      dates.push({ t: 'abs', date: addDays(today, 2) });
      take(i, i + 1, i + 2);
    } else if (k === 'hoje') {
      dates.push({ t: 'abs', date: today });
      take(i);
    } else if (k === 'amanha') {
      dates.push({ t: 'abs', date: addDays(today, 1) });
      take(i);
    } else if (k === 'ontem') {
      dates.push({ t: 'abs', date: addDays(today, -1) });
      take(i);
    } else if (k === 'anteontem') {
      dates.push({ t: 'abs', date: addDays(today, -2) });
      take(i);
    } else if (/^(segunda|terca|quarta|quinta|sexta)(-feira)?$/.test(k) || k === 'sabado' || k === 'domingo') {
      dates.push({ t: 'wd', wd: WEEKDAYS[k.replace('-feira', '')]! });
      take(i);
      if (keyAt(i + 1) === 'feira') take(i + 1);
    } else if (k === 'dia' && /^\d{1,2}$/.test(keyAt(i + 1)) && Number(keyAt(i + 1)) >= 1 && Number(keyAt(i + 1)) <= 31) {
      dates.push({ t: 'dom', n: Number(keyAt(i + 1)) });
      take(i, i + 1);
    } else if (/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(k)) {
      const [d, m, y] = k.split('/').map(Number) as [number, number, number | undefined];
      const year = y === undefined ? null : y < 100 ? 2000 + y : y;
      dates.push({ t: 'dm', d, m, y: year });
      take(i);
      if (k && i > 0 && keyAt(i - 1) === 'dia' && free(i - 1)) take(i - 1);
    } else if (/^\d{1,2}h(?:\d{2})?$/.test(k) || /^\d{1,2}:\d{2}$/.test(k)) {
      const [h, m = 0] = k.split(/[h:]/).map((p) => (p === '' ? 0 : Number(p))) as [number, number | undefined];
      if (h < 24 && m < 60) {
        times.push(timeText(h, m));
        take(i);
        if (free(i - 1) && keyAt(i - 1) === 'as') take(i - 1);
      }
    } else if (k === 'as' && /^\d{1,2}$/.test(keyAt(i + 1)) && Number(keyAt(i + 1)) < 24) {
      times.push(timeText(Number(keyAt(i + 1)), 0));
      take(i, i + 1);
    } else if (/^\d{1,2}$/.test(k) && (keyAt(i + 1) === 'horas' || keyAt(i + 1) === 'hora') && Number(k) < 24) {
      times.push(timeText(Number(k), 0));
      take(i, i + 1);
    } else if (k === 'meio-dia' || (k === 'meio' && keyAt(i + 1) === 'dia')) {
      times.push('12:00');
      take(i);
      if (k === 'meio') take(i + 1);
    } else if (VAGUE_PARTS.has(k)) {
      vagueTime = true;
      take(i);
      if (i > 0 && free(i - 1) && ['de', 'da', 'pela', 'a', 'na', 'no'].includes(keyAt(i - 1))) take(i - 1);
    }
  }

  if (dates.length > 1 || times.length > 1) return null;

  // Valores. Só tokens que ainda estão livres.
  const amounts: Amount[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (consumed.has(i)) continue;
    const k = keyAt(i);
    const prefixOnly = k === 'r$';
    const prefixedNumber = /^r\$\d/.test(k);
    if (prefixOnly && free(i + 1) && NUMBER_RE.test(keyAt(i + 1))) {
      amounts.push({ index: i, cents: centsOf(keyAt(i + 1)), form: 'prefixed' });
      take(i, i + 1);
    } else if (prefixedNumber) {
      amounts.push({ index: i, cents: centsOf(k.slice(2)), form: 'prefixed' });
      take(i);
    } else if (NUMBER_RE.test(k)) {
      amounts.push({ index: i, cents: centsOf(k), form: k.includes(',') ? 'decimal' : 'bare' });
    }
  }

  const rest = tokens.filter((_, i) => !consumed.has(i) && !amounts.some((a) => a.index === i && a.form !== 'bare'));
  const restKeys = rest.map((t) => t.key);
  const hasMoneyVerb = restKeys.some((k) => MONEY_VERBS.has(k));
  const hasIncomeVerb = restKeys.some((k) => INCOME_VERBS.has(k));
  const hasFutureIncome = restKeys.some((k) => FUTURE_INCOME.has(k));
  const hasBill = restKeys.some((k) => BILL_WORDS.has(k));
  const hasPagar = restKeys.includes('pagar');
  const hasCategoryWord = restKeys.some((k) => CATEGORY_KEYS.has(k));
  const moneyIntent = hasMoneyVerb || hasIncomeVerb || hasFutureIncome || hasBill || hasPagar;

  // Número solto só vale como valor quando o resto da frase fala de dinheiro.
  const usable = amounts.filter((a) => a.form !== 'bare' || moneyIntent || hasCategoryWord);
  if (usable.length > 1) return null;
  const amount = usable[0];

  const dateSpec = dates[0];
  const time = times[0] ?? null;

  // Ordem original, sem o valor, sem datas/horas já lidas.
  const words = tokens.filter((_, i) => !consumed.has(i) && (amount === undefined || i !== amount.index)).map((t) => t.raw);

  if (amount === undefined) {
    if (hasMoneyVerb || hasIncomeVerb || hasFutureIncome) return null; // fala de dinheiro, mas sem valor
    let title = trimEdges(words).join(' ').replace(REMINDER_PREFIX, '');
    // O prefixo "me lembra de" fica no começo das palavras originais; refaz a limpeza se ele estava lá.
    title = trimEdges(title.split(' ').filter((w) => w !== '')).join(' ');
    if (title === '' || title.length > TITLE_MAX) return null;
    // Sem data, só vira tarefa se começar por um verbo no infinitivo ("ligar pra Ana", "comprar pão"): uma
    // frase qualquer ("oi", "academia", "me explica o prazo") é ambígua demais e fica para o assistente.
    if (dateSpec === undefined && !/^\p{L}{2,}(?:ar|er|ir|or)$/u.test(fold(title.split(' ')[0] ?? ''))) return null;
    const date = dateSpec === undefined ? null : resolveDate(dateSpec, today, 'future');
    if (dateSpec !== undefined && date === null) return null;
    return { kind: 'tarefa', title, date, time: date === null ? null : time, vagueTime: date !== null && time === null && vagueTime };
  }

  if (amount.cents === null || amount.cents < 1 || amount.cents > FINANCE_MAX_CENTS) return null;

  type Kind = 'gasto' | 'entrada' | 'conta';
  let kind: Kind;
  let status: 'paga' | 'a_pagar' = 'paga';
  let direction: 'future' | 'past' = 'past';
  if (hasFutureIncome) {
    kind = 'entrada';
    status = 'a_pagar';
    direction = 'future';
  } else if (hasIncomeVerb) {
    kind = 'entrada';
  } else if (hasBill || hasPagar) {
    kind = 'conta';
    status = 'a_pagar';
    direction = 'future';
  } else if (hasMoneyVerb) {
    kind = 'gasto';
  } else if (dateSpec !== undefined && (resolveDate(dateSpec, today, 'future') ?? today) > today) {
    // Sem verbo, uma data que ainda vai chegar é um vencimento ("aluguel 1200 amanhã").
    kind = 'conta';
    status = 'a_pagar';
    direction = 'future';
  } else {
    kind = 'gasto';
  }

  let date: IsoDate | null;
  if (dateSpec === undefined) date = status === 'paga' ? today : null;
  else date = resolveDate(dateSpec, today, direction);
  if (dateSpec !== undefined && date === null) return null;

  const cleaned = trimEdges(
    words.filter((w) => {
      const k = fold(w).replace(/[.,;:!?]+$/, '');
      return !MONEY_VERBS.has(k) && !INCOME_VERBS.has(k) && !FUTURE_INCOME.has(k) && !FILLER_WORDS.has(k) && k !== 'vence' && k !== 'vencimento' && k !== 'vencendo' && k !== 'r$';
    }),
  );
  const keys = cleaned.map((w) => fold(w).replace(/[.,;:!?]+$/, ''));
  const defaultName = kind === 'gasto' ? 'Gasto' : kind === 'entrada' ? 'Entrada' : 'Conta';
  const description = (cleaned.join(' ') || defaultName).slice(0, DESCRIPTION_MAX).trim();
  const category = kind === 'entrada' ? categoryOf(keys, INCOME_CATEGORY_WORDS) : categoryOf(keys, CATEGORY_WORDS);

  return { kind, description, amountCents: amount.cents, category, date, time, status };
}
