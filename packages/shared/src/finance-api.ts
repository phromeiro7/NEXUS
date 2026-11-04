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

const descriptionSchema = z.string().trim().min(1).max(120);
const categorySchema = z.string().trim().min(1).max(40);
const amountSchema = z.number().int().min(1).max(FINANCE_MAX_CENTS);

/**
 * Gasto é dinheiro já gasto: sempre `paga`. Vale na criação e depois de qualquer mudança.
 * O horário do lembrete pode ficar guardado numa conta paga, para "Desfazer" o pagamento.
 */
export function isConsistentFinanceEntry(v: { kind: FinanceKind; status: FinanceStatus }): boolean {
  return v.kind !== 'gasto' || v.status === 'paga';
}

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
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one field is required',
  });
export type UpdateFinanceEntryInput = z.infer<typeof updateFinanceEntryInputSchema>;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function monthRange(month: string): { from: IsoDate; to: IsoDate } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/**
 * Query-string de `GET /finance-entries`. Sem filtros: tudo (a API limita o tamanho).
 * `month` (YYYY-MM) é atalho para `from`/`to` e não pode vir junto deles.
 * Saída normalizada: só `from`, `to` e `status`.
 */
export const listFinanceEntriesQuerySchema = z
  .object({
    month: z.string().regex(MONTH_RE).optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    status: financeStatusSchema.optional(),
  })
  .refine((v) => v.month === undefined || (v.from === undefined && v.to === undefined), {
    message: 'month cannot be combined with from/to',
    path: ['month'],
  })
  .refine((v) => v.from === undefined || v.to === undefined || v.from <= v.to, {
    message: 'from must be on or before to',
    path: ['from'],
  })
  .transform(({ month, ...rest }) => {
    const range = month === undefined ? {} : monthRange(month);
    return { ...rest, ...range } as { from?: IsoDate; to?: IsoDate; status?: FinanceStatus };
  });
export type ListFinanceEntriesQuery = z.output<typeof listFinanceEntriesQuerySchema>;

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
