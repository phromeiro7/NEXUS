import { z } from 'zod';
import { isoDateSchema, type IsoDate } from './primitives.js';
import { timeOfDaySchema } from './time-of-day.js';

/** gasto: saída já feita · conta: saída com vencimento · entrada: dinheiro que chega. */
export const financeKindSchema = z.enum(['gasto', 'conta', 'entrada']);
export type FinanceKind = z.infer<typeof financeKindSchema>;

/** `a_pagar` também vale para entrada ("vou receber"): ainda não aconteceu. */
export const financeStatusSchema = z.enum(['paga', 'a_pagar']);
export type FinanceStatus = z.infer<typeof financeStatusSchema>;

/** R$ 999.999.999,99: dinheiro é sempre inteiro em centavos, nunca ponto flutuante. */
export const FINANCE_MAX_CENTS = 99_999_999_999;

const DESCRIPTION_MAX = 120;
const CATEGORY_MAX = 40;

const descriptionSchema = z.string().trim().min(1).max(DESCRIPTION_MAX);
const categorySchema = z.string().trim().min(1).max(CATEGORY_MAX);
const amountSchema = z.number().int().min(1).max(FINANCE_MAX_CENTS);

/**
 * Gasto é dinheiro já gasto: sempre `paga`. Vale na criação e depois de qualquer mudança.
 * O horário do lembrete pode ficar guardado numa conta paga, para "Desfazer" o pagamento.
 */
export function isConsistentFinanceEntry(entry: { kind: FinanceKind; status: FinanceStatus }): boolean {
  return entry.kind !== 'gasto' || entry.status === 'paga';
}

/** Corpo de `POST /finance-entries`. */
export const createFinanceEntryInputSchema = z
  .object({
    /** Opcional: o cliente pode gerar o id (criação otimista e "Desfazer" de uma exclusão). */
    id: z.uuid().optional(),
    kind: financeKindSchema,
    description: descriptionSchema,
    amountCents: amountSchema,
    category: categorySchema.nullable().default(null),
    /** Dia do lançamento; para o que está a pagar, o vencimento. */
    dueDate: isoDateSchema,
    status: financeStatusSchema.default('paga'),
    reminderTime: timeOfDaySchema.nullable().default(null),
  })
  .strict()
  .refine(isConsistentFinanceEntry, {
    message: 'gasto must be paga',
    path: ['status'],
  });
export type CreateFinanceEntryInput = z.infer<typeof createFinanceEntryInputSchema>;

/** Corpo de `PATCH /finance-entries/:id`: só os campos enviados mudam; pelo menos um é obrigatório. */
export const updateFinanceEntryInputSchema = z
  .object({
    description: descriptionSchema.optional(),
    amountCents: amountSchema.optional(),
    category: categorySchema.nullable().optional(),
    dueDate: isoDateSchema.optional(),
    status: financeStatusSchema.optional(),
    reminderTime: timeOfDaySchema.nullable().optional(),
  })
  .strict()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'At least one field is required',
  });
export type UpdateFinanceEntryInput = z.infer<typeof updateFinanceEntryInputSchema>;

/** `YYYY-MM`, mês de 01 a 12. */
const YEAR_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Primeiro e último dia do mês `YYYY-MM`. */
function monthRange(yearMonth: string): { from: IsoDate; to: IsoDate } {
  const [year, month] = yearMonth.split('-').map(Number) as [number, number];
  // Dia 0 do mês seguinte = último dia deste mês (`month` já é o índice 0-based do mês seguinte).
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${yearMonth}-01`, to: `${yearMonth}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * Query-string de `GET /finance-entries`. Sem filtros: tudo (a API limita o tamanho).
 * `month` (YYYY-MM) é atalho para `from`/`to` e não pode vir junto deles.
 * Saída normalizada: só `from`, `to` e `status`.
 */
export const listFinanceEntriesQuerySchema = z
  .object({
    month: z.string().regex(YEAR_MONTH_PATTERN).optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    status: financeStatusSchema.optional(),
  })
  .refine((query) => query.month === undefined || (query.from === undefined && query.to === undefined), {
    message: 'month cannot be combined with from/to',
    path: ['month'],
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: 'from must be on or before to',
    path: ['from'],
  })
  .transform(({ month, ...rest }) => {
    const range = month === undefined ? {} : monthRange(month);
    return { ...rest, ...range } as { from?: IsoDate; to?: IsoDate; status?: FinanceStatus };
  });
export type ListFinanceEntriesQuery = z.output<typeof listFinanceEntriesQuerySchema>;

/** Lançamento financeiro como a API devolve. */
export type FinanceEntryDto = {
  id: string;
  kind: FinanceKind;
  description: string;
  amountCents: number;
  category: string | null;
  dueDate: IsoDate;
  status: FinanceStatus;
  /** `HH:mm`; só armazenado nesta etapa (nenhum lembrete é enviado ainda). */
  reminderTime: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};
