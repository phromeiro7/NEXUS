import { z } from 'zod';
import { FINANCE_MAX_CENTS } from './finance-api.js';
import { isoDateSchema, type IsoDate } from './primitives.js';
import { timeOfDaySchema } from './time-of-day.js';

/** Frase digitada na barra de captura do painel; o mesmo texto que a pessoa mandaria ao bot. */
export const CAPTURE_TEXT_MAX = 500;

export const interpretCaptureInputSchema = z.object({
  text: z.string().trim().min(1).max(CAPTURE_TEXT_MAX),
});
export type InterpretCaptureInput = z.infer<typeof interpretCaptureInputSchema>;

/**
 * O que as regras entenderam. Nada é gravado: a pessoa confirma e só então o painel cria a tarefa ou o
 * lançamento pelas rotas de sempre. `date` e `time` são `null` quando a frase não disse (nunca assumidos).
 */
export const captureProposalSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['gasto', 'entrada', 'conta']),
    description: z.string().min(1),
    amountCents: z.number().int().min(1).max(FINANCE_MAX_CENTS),
    category: z.string().nullable(),
    date: isoDateSchema.nullable(),
    time: timeOfDaySchema.nullable(),
    status: z.enum(['paga', 'a_pagar']),
  }),
  z.object({
    kind: z.literal('tarefa'),
    title: z.string().min(1),
    date: isoDateSchema.nullable(),
    time: timeOfDaySchema.nullable(),
    /** "de manhã", "de tarde": a frase falou de um período, mas não de um horário. */
    vagueTime: z.boolean(),
  }),
]);
export type CaptureProposalDto = z.infer<typeof captureProposalSchema>;

export type InterpretCaptureResultDto = {
  /** "Hoje" no fuso das configurações da pessoa: a base de qualquer data relativa. */
  today: IsoDate;
  /** `null` = as regras não entenderam; o painel mostra exemplos. */
  proposal: CaptureProposalDto | null;
};
