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

/** O que a frase parece ser: lançamento financeiro (gasto, entrada, conta) ou tarefa. */
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

/** Limite do título de tarefa capturada (o mesmo da API de tarefas). */
export const TITLE_MAX = 200;
/** Limite da descrição de lançamento capturado (o mesmo da API de finanças). */
export const DESCRIPTION_MAX = 120;

/** Minúsculas e sem acentos: "Terça" e "terca" viram a mesma chave. */
const normalizeForComparison = (text: string): string =>
  text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/** Chave de comparação de uma palavra: normalizada e sem a pontuação final ("amanhã," -> "amanha"). */
const comparisonKey = (word: string): string => normalizeForComparison(word).replace(TRAILING_PUNCTUATION, '');

/** `original`: a palavra como foi digitada; `key`: a chave de comparação. */
type Token = { original: string; key: string };

/** Data como a pessoa disse, antes de virar uma data de calendário (que depende de hoje e do sentido). */
type DateSpec =
  | { kind: 'absoluteDate'; date: IsoDate }
  | { kind: 'dayOfMonth'; day: number }
  | { kind: 'weekday'; weekday: number }
  | { kind: 'dayAndMonth'; day: number; month: number; year: number | null };

/** Para onde procurar uma data incompleta: gasto já aconteceu (passado), conta ainda vai vencer (futuro). */
type DateDirection = 'future' | 'past';

const WEEKDAY_NUMBERS: Record<string, number> = {
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
const FUTURE_INCOME_VERBS = new Set(['recebo', 'receberei', 'receber']);
const BILL_WORDS = new Set(['vence', 'vencimento', 'vencendo', 'boleto', 'fatura']);
const DUE_WORDS = new Set(['vence', 'vencimento', 'vencendo']);
const FILLER_WORDS = new Set(['reais', 'real', 'vou', 'vai', 'entrar', 'pagar']);
const PREPOSITIONS = new Set(['em', 'no', 'na', 'nos', 'nas', 'de', 'do', 'da', 'dos', 'das', 'com', 'para', 'pra', 'por', 'pelo', 'pela', 'a', 'o', 'as', 'os', 'e']);
const VAGUE_DAY_PERIODS = new Set(['manha', 'tarde', 'noite', 'madrugada']);
/** Palavras que podem vir antes de um período vago ("de manhã", "à tarde", "na madrugada"). */
const VAGUE_PERIOD_LEAD_WORDS = ['de', 'da', 'pela', 'a', 'na', 'no'];
const GREETINGS = new Set(['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'obrigado', 'obrigada', 'valeu', 'tudo bem', 'ok', 'certo', 'ajuda', 'help']);
const CURRENCY_PREFIX = 'r$';

type CategoryTable = ReadonlyArray<readonly [category: string, words: readonly string[]]>;

const CATEGORY_WORDS: CategoryTable = [
  ['Roupas', ['roupa', 'roupas', 'camisa', 'camiseta', 'sapato', 'tenis', 'calca', 'vestido', 'jaqueta', 'blusa']],
  ['Mercado', ['mercado', 'supermercado', 'mercadinho', 'feira', 'padaria', 'acougue', 'hortifruti', 'pao']],
  ['Transporte', ['uber', '99', 'taxi', 'onibus', 'metro', 'gasolina', 'combustivel', 'estacionamento', 'pedagio', 'passagem']],
  ['Lazer', ['cinema', 'bar', 'restaurante', 'almoco', 'jantar', 'lanche', 'ifood', 'cerveja', 'show', 'festa', 'pizza', 'cafe', 'balada', 'netflix', 'spotify']],
  ['Moradia', ['aluguel', 'condominio', 'luz', 'agua', 'internet', 'gas', 'iptu', 'energia']],
  ['Saúde', ['farmacia', 'remedio', 'medico', 'consulta', 'dentista', 'exame', 'saude']],
];

const INCOME_CATEGORY_WORDS: CategoryTable = [
  ['Freela', ['freela', 'freelance', 'freelancer']],
  ['Salário', ['salario']],
];

const CATEGORY_KEYS = new Set(CATEGORY_WORDS.flatMap(([, words]) => words));

/** Primeira categoria da tabela com alguma palavra presente na frase; `null` se nenhuma. */
function findCategory(keys: string[], table: CategoryTable): string | null {
  for (const [category, words] of table) if (keys.some((key) => words.includes(key))) return category;
  return null;
}

// ----- datas -----

const MONTHS_PER_YEAR = 12;
/** Procura o dia N em até 14 meses: cobre qualquer dia 1..31 (o 31 pode faltar em vários meses seguidos). */
const MAX_MONTHS_TO_SEARCH = 14;
const DAYS_PER_WEEK = 7;
/** "5/3/26": ano com dois dígitos é deste século. */
const TWO_DIGIT_YEAR_BASE = 2000;

/** Data ISO a partir de ano, mês e dia; `null` se a data não existe (ex.: 31/04). */
const buildIsoDate = (year: number, month: number, day: number): IsoDate | null => {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
  if (!isRealDate) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` as IsoDate;
};

const splitIsoDate = (date: IsoDate): [year: number, month: number, day: number] =>
  date.split('-').map(Number) as [number, number, number];

const isInDirection = (date: IsoDate, today: IsoDate, direction: DateDirection): boolean =>
  direction === 'future' ? date >= today : date <= today;

/** Primeiro mês (a partir do atual, para a frente ou para trás) em que o dia N existe e respeita o sentido. */
function resolveDayOfMonth(today: IsoDate, day: number, direction: DateDirection): IsoDate | null {
  const [year, month] = splitIsoDate(today);
  for (let step = 0; step < MAX_MONTHS_TO_SEARCH; step += 1) {
    const monthOffset = direction === 'future' ? step : -step;
    // Conta em meses absolutos (ano * 12 + mês) para atravessar a virada do ano sem casos especiais.
    const absoluteMonth = year * MONTHS_PER_YEAR + (month - 1) + monthOffset;
    const candidate = buildIsoDate(
      Math.floor(absoluteMonth / MONTHS_PER_YEAR),
      (absoluteMonth % MONTHS_PER_YEAR) + 1,
      day,
    );
    if (candidate === null) continue;
    if (isInDirection(candidate, today, direction)) return candidate;
  }
  return null;
}

function resolveDate(spec: DateSpec, today: IsoDate, direction: DateDirection): IsoDate | null {
  switch (spec.kind) {
    case 'absoluteDate':
      return spec.date;
    case 'dayOfMonth':
      return resolveDayOfMonth(today, spec.day, direction);
    case 'weekday': {
      if (direction === 'future') {
        // "sexta" numa sexta é a da semana seguinte (`|| 7` troca o 0 por uma semana inteira).
        const daysAhead = (spec.weekday - weekday(today) + DAYS_PER_WEEK) % DAYS_PER_WEEK || DAYS_PER_WEEK;
        return addDays(today, daysAhead);
      }
      const daysBack = (weekday(today) - spec.weekday + DAYS_PER_WEEK) % DAYS_PER_WEEK;
      return addDays(today, -daysBack);
    }
    case 'dayAndMonth': {
      if (spec.year !== null) return buildIsoDate(spec.year, spec.month, spec.day);
      const [currentYear] = splitIsoDate(today);
      const candidateYears = direction === 'future' ? [currentYear, currentYear + 1] : [currentYear, currentYear - 1];
      for (const candidateYear of candidateYears) {
        const candidate = buildIsoDate(candidateYear, spec.month, spec.day);
        if (candidate !== null && isInDirection(candidate, today, direction)) return candidate;
      }
      return null;
    }
  }
}

// ----- números -----

/** Valor em reais no formato brasileiro: "45", "119,90", "1.200" ou "1.200,50" (milhar com ponto, centavos com vírgula). */
const MONEY_NUMBER_PATTERN = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/;

/** Centavos de um valor no formato brasileiro; `null` se não for número ou passar do inteiro seguro. */
function parseCents(text: string): number | null {
  if (!MONEY_NUMBER_PATTERN.test(text)) return null;
  const [integerPart = '', decimalPart = ''] = text.split(',');
  const cents = Number(integerPart.replace(/\./g, '')) * 100 + Number(decimalPart.padEnd(2, '0') || '0');
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Valor encontrado na frase. `form` diz quão claro ele é: `prefixed` ("R$ 45"), `decimal` ("45,90") ou
 * `bare` (número solto, que só vale como dinheiro se o resto da frase falar de dinheiro).
 */
type Amount = { index: number; cents: number | null; form: 'prefixed' | 'decimal' | 'bare' };

const formatTime = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/** Remove as palavras de ligação que sobram nas pontas ("em roupa" -> "roupa", "pra" solto no fim). */
function trimEdges(words: string[]): string[] {
  const trimmed = [...words];
  while (trimmed.length > 0 && PREPOSITIONS.has(normalizeForComparison(trimmed[0]!))) trimmed.shift();
  while (trimmed.length > 0 && PREPOSITIONS.has(normalizeForComparison(trimmed[trimmed.length - 1]!))) trimmed.pop();
  return trimmed;
}

/** "me lembra de", "me lembrar para", "lembrar de", "lembrete pra": abertura de pedido de lembrete. */
const REMINDER_PREFIX = /^(?:me\s+lembr[ae]r?\s+(?:de|para|pra)\s+|lembrar\s+(?:de|para|pra)\s+|lembrete\s+(?:de|para|pra)?\s*)/i;

/** Palavra que parece verbo no infinitivo ("ligar", "comprar", "fazer", "compor"). */
const INFINITIVE_VERB_PATTERN = /^\p{L}{2,}(?:ar|er|ir|or)$/u;

const WEEKDAY_NAME_PATTERN = /^(segunda|terca|quarta|quinta|sexta)(-feira)?$/;
const DAY_NUMBER_PATTERN = /^\d{1,2}$/;
/** "5/3", "05/03/26", "5/3/2026". */
const DAY_MONTH_PATTERN = /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/;
/** "9h", "9h30". */
const HOUR_WITH_H_PATTERN = /^\d{1,2}h(?:\d{2})?$/;
/** "9:30". */
const HOUR_WITH_COLON_PATTERN = /^\d{1,2}:\d{2}$/;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const DAYS_IN_LONGEST_MONTH = 31;
const NOON = '12:00';

/**
 * Interpreta uma frase de chat como proposta de gasto, entrada, conta ou tarefa (veja as regras no topo
 * do arquivo). `today` é o dia local do usuário. `null` quando a frase não é um registro ou é ambígua.
 */
export function interpretCapture(text: string, today: IsoDate): CaptureProposal | null {
  const normalizedText = text.trim().replace(/\s+/g, ' ');
  if (normalizedText === '') return null;
  if (GREETINGS.has(comparisonKey(normalizedText))) return null;
  // Pergunta não é registro: quem responde é o assistente (ou a ajuda).
  if (normalizedText.includes('?')) return null;

  const tokens: Token[] = normalizedText.split(' ').map((original) => ({ original, key: comparisonKey(original) }));
  // Índices dos tokens já lidos como data, hora ou valor: não entram na descrição/título.
  const consumed = new Set<number>();
  const dates: DateSpec[] = [];
  const times: string[] = [];
  let vagueTime = false;

  const keyAt = (index: number): string => tokens[index]?.key ?? '';
  const isFree = (index: number): boolean => index < tokens.length && !consumed.has(index);
  const consume = (...indexes: number[]): void => indexes.forEach((index) => consumed.add(index));

  // 1ª passada: datas e horários.
  for (let i = 0; i < tokens.length; i += 1) {
    if (consumed.has(i)) continue;
    const key = keyAt(i);
    const nextKey = keyAt(i + 1);

    if (key === 'depois' && nextKey === 'de' && keyAt(i + 2) === 'amanha') {
      dates.push({ kind: 'absoluteDate', date: addDays(today, 2) });
      consume(i, i + 1, i + 2);
    } else if (key === 'hoje') {
      dates.push({ kind: 'absoluteDate', date: today });
      consume(i);
    } else if (key === 'amanha') {
      dates.push({ kind: 'absoluteDate', date: addDays(today, 1) });
      consume(i);
    } else if (key === 'ontem') {
      dates.push({ kind: 'absoluteDate', date: addDays(today, -1) });
      consume(i);
    } else if (key === 'anteontem') {
      dates.push({ kind: 'absoluteDate', date: addDays(today, -2) });
      consume(i);
    } else if (WEEKDAY_NAME_PATTERN.test(key) || key === 'sabado' || key === 'domingo') {
      dates.push({ kind: 'weekday', weekday: WEEKDAY_NUMBERS[key.replace('-feira', '')]! });
      consume(i);
      // "sexta feira" escrito separado.
      if (nextKey === 'feira') consume(i + 1);
    } else if (
      key === 'dia' &&
      DAY_NUMBER_PATTERN.test(nextKey) &&
      Number(nextKey) >= 1 &&
      Number(nextKey) <= DAYS_IN_LONGEST_MONTH
    ) {
      dates.push({ kind: 'dayOfMonth', day: Number(nextKey) });
      consume(i, i + 1);
    } else if (DAY_MONTH_PATTERN.test(key)) {
      const [day, month, writtenYear] = key.split('/').map(Number) as [number, number, number | undefined];
      const year =
        writtenYear === undefined ? null : writtenYear < 100 ? TWO_DIGIT_YEAR_BASE + writtenYear : writtenYear;
      dates.push({ kind: 'dayAndMonth', day, month, year });
      consume(i);
      // "dia 5/3": o "dia" antes também é parte da data.
      if (key && i > 0 && keyAt(i - 1) === 'dia' && isFree(i - 1)) consume(i - 1);
    } else if (HOUR_WITH_H_PATTERN.test(key) || HOUR_WITH_COLON_PATTERN.test(key)) {
      const [hour, minute = 0] = key.split(/[h:]/).map((part) => (part === '' ? 0 : Number(part))) as [
        number,
        number | undefined,
      ];
      if (hour < HOURS_PER_DAY && minute < MINUTES_PER_HOUR) {
        times.push(formatTime(hour, minute));
        consume(i);
        // "às 9h": o "às" antes também é parte do horário.
        if (isFree(i - 1) && keyAt(i - 1) === 'as') consume(i - 1);
      }
    } else if (key === 'as' && DAY_NUMBER_PATTERN.test(nextKey) && Number(nextKey) < HOURS_PER_DAY) {
      // "às 9".
      times.push(formatTime(Number(nextKey), 0));
      consume(i, i + 1);
    } else if (
      DAY_NUMBER_PATTERN.test(key) &&
      (nextKey === 'horas' || nextKey === 'hora') &&
      Number(key) < HOURS_PER_DAY
    ) {
      // "9 horas".
      times.push(formatTime(Number(key), 0));
      consume(i, i + 1);
    } else if (key === 'meio-dia' || (key === 'meio' && nextKey === 'dia')) {
      times.push(NOON);
      consume(i);
      if (key === 'meio') consume(i + 1);
    } else if (VAGUE_DAY_PERIODS.has(key)) {
      vagueTime = true;
      consume(i);
      if (i > 0 && isFree(i - 1) && VAGUE_PERIOD_LEAD_WORDS.includes(keyAt(i - 1))) consume(i - 1);
    }
  }

  if (dates.length > 1 || times.length > 1) return null;

  // 2ª passada: valores. Só tokens que ainda estão livres.
  const amounts: Amount[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (consumed.has(i)) continue;
    const key = keyAt(i);
    const isCurrencyAlone = key === CURRENCY_PREFIX;
    const isCurrencyGluedToNumber = /^r\$\d/.test(key);
    if (isCurrencyAlone && isFree(i + 1) && MONEY_NUMBER_PATTERN.test(keyAt(i + 1))) {
      amounts.push({ index: i, cents: parseCents(keyAt(i + 1)), form: 'prefixed' });
      consume(i, i + 1);
    } else if (isCurrencyGluedToNumber) {
      amounts.push({ index: i, cents: parseCents(key.slice(CURRENCY_PREFIX.length)), form: 'prefixed' });
      consume(i);
    } else if (MONEY_NUMBER_PATTERN.test(key)) {
      // Número solto não é consumido: se não virar valor, continua no título/descrição.
      amounts.push({ index: i, cents: parseCents(key), form: key.includes(',') ? 'decimal' : 'bare' });
    }
  }

  const remainingKeys = tokens
    .filter((_, i) => !consumed.has(i) && !amounts.some((amount) => amount.index === i && amount.form !== 'bare'))
    .map((token) => token.key);
  const hasMoneyVerb = remainingKeys.some((key) => MONEY_VERBS.has(key));
  const hasIncomeVerb = remainingKeys.some((key) => INCOME_VERBS.has(key));
  const hasFutureIncomeVerb = remainingKeys.some((key) => FUTURE_INCOME_VERBS.has(key));
  const hasBillWord = remainingKeys.some((key) => BILL_WORDS.has(key));
  const hasPayInfinitive = remainingKeys.includes('pagar');
  const hasCategoryWord = remainingKeys.some((key) => CATEGORY_KEYS.has(key));
  const talksAboutMoney = hasMoneyVerb || hasIncomeVerb || hasFutureIncomeVerb || hasBillWord || hasPayInfinitive;

  // Número solto só vale como valor quando o resto da frase fala de dinheiro.
  const usableAmounts = amounts.filter((amount) => amount.form !== 'bare' || talksAboutMoney || hasCategoryWord);
  if (usableAmounts.length > 1) return null;
  const amount = usableAmounts[0];

  const dateSpec = dates[0];
  const time = times[0] ?? null;

  // Ordem original, sem o valor, sem datas/horas já lidas.
  const words = tokens
    .filter((_, i) => !consumed.has(i) && (amount === undefined || i !== amount.index))
    .map((token) => token.original);

  if (amount === undefined) {
    const mentionsMoneyWithoutAmount = hasMoneyVerb || hasIncomeVerb || hasFutureIncomeVerb;
    if (mentionsMoneyWithoutAmount) return null;
    let title = trimEdges(words).join(' ').replace(REMINDER_PREFIX, '');
    // O prefixo "me lembra de" fica no começo das palavras originais; refaz a limpeza se ele estava lá.
    title = trimEdges(title.split(' ').filter((word) => word !== '')).join(' ');
    if (title === '' || title.length > TITLE_MAX) return null;
    // Sem data, só vira tarefa se começar por um verbo no infinitivo ("ligar pra Ana", "comprar pão"): uma
    // frase qualquer ("oi", "academia", "me explica o prazo") é ambígua demais e fica para o assistente.
    const startsWithInfinitive = INFINITIVE_VERB_PATTERN.test(normalizeForComparison(title.split(' ')[0] ?? ''));
    if (dateSpec === undefined && !startsWithInfinitive) return null;
    const date = dateSpec === undefined ? null : resolveDate(dateSpec, today, 'future');
    if (dateSpec !== undefined && date === null) return null;
    return {
      kind: 'tarefa',
      title,
      date,
      time: date === null ? null : time,
      vagueTime: date !== null && time === null && vagueTime,
    };
  }

  if (amount.cents === null || amount.cents < 1 || amount.cents > FINANCE_MAX_CENTS) return null;

  type FinanceProposalKind = 'gasto' | 'entrada' | 'conta';
  let kind: FinanceProposalKind;
  let status: 'paga' | 'a_pagar' = 'paga';
  let direction: DateDirection = 'past';
  if (hasFutureIncomeVerb) {
    kind = 'entrada';
    status = 'a_pagar';
    direction = 'future';
  } else if (hasIncomeVerb) {
    kind = 'entrada';
  } else if (hasBillWord || hasPayInfinitive) {
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

  // A descrição é o que sobra sem verbos de dinheiro, palavras de enchimento, "vence" e "R$".
  const isDescriptionWord = (key: string): boolean =>
    !MONEY_VERBS.has(key) &&
    !INCOME_VERBS.has(key) &&
    !FUTURE_INCOME_VERBS.has(key) &&
    !FILLER_WORDS.has(key) &&
    !DUE_WORDS.has(key) &&
    key !== CURRENCY_PREFIX;
  const descriptionWords = trimEdges(words.filter((word) => isDescriptionWord(comparisonKey(word))));
  const descriptionKeys = descriptionWords.map(comparisonKey);
  const defaultDescription = kind === 'gasto' ? 'Gasto' : kind === 'entrada' ? 'Entrada' : 'Conta';
  const description = (descriptionWords.join(' ') || defaultDescription).slice(0, DESCRIPTION_MAX).trim();
  const category =
    kind === 'entrada'
      ? findCategory(descriptionKeys, INCOME_CATEGORY_WORDS)
      : findCategory(descriptionKeys, CATEGORY_WORDS);

  return { kind, description, amountCents: amount.cents, category, date, time, status };
}
