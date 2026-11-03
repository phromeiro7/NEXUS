import { z } from 'zod';

export const caseStatusSchema = z.enum(['ativo', 'arquivado']);
export type CaseStatus = z.infer<typeof caseStatusSchema>;

const numberSchema = z.string().trim().min(1).max(60);
const clientNameSchema = z.string().trim().max(200).nullable();
const descriptionSchema = z.string().trim().max(1000).nullable();

export const createCaseInputSchema = z.object({
  number: numberSchema,
  clientName: clientNameSchema.optional(),
  description: descriptionSchema.optional(),
});
export type CreateCaseInput = z.infer<typeof createCaseInputSchema>;

export const updateCaseInputSchema = z
  .object({
    number: numberSchema.optional(),
    clientName: clientNameSchema.optional(),
    description: descriptionSchema.optional(),
    status: caseStatusSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one field is required',
  });
export type UpdateCaseInput = z.infer<typeof updateCaseInputSchema>;

export type CaseDto = {
  id: string;
  number: string;
  clientName: string | null;
  description: string | null;
  status: CaseStatus;
  createdAt: string;
  updatedAt: string;
};
