import { z } from 'zod';

/** Convite: 12 caracteres sem ambíguos (0/O, 1/I/L), distinto do código de vínculo (8). */
export const INVITE_CODE_LENGTH = 12;
export const inviteCodeSchema = z.string().regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/);

export const inviteStatusSchema = z.enum(['ativo', 'usado', 'expirado', 'revogado']);
export type InviteStatus = z.infer<typeof inviteStatusSchema>;

export const INVITE_LABEL_MAX = 60;
export const createInviteInputSchema = z.object({
  label: z
    .string()
    .trim()
    .max(INVITE_LABEL_MAX)
    .optional()
    // Rótulo vazio é o mesmo que nenhum rótulo.
    .transform((label) => (label === undefined || label === '' ? undefined : label)),
});
export type CreateInviteInput = z.input<typeof createInviteInputSchema>;

export const inviteDtoSchema = z.object({
  code: inviteCodeSchema,
  /** https://t.me/<bot>?start=<codigo>: pronto para encaminhar. */
  link: z.string(),
  status: inviteStatusSchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  usedAt: z.string().nullable(),
  /** Nome dado pelo administrador ao criar, só para controle. */
  label: z.string().nullable(),
});
export type InviteDto = z.infer<typeof inviteDtoSchema>;

/** Contagem dos convites gerados (só os que ainda existem; apagado some da conta). */
export const inviteSummaryDtoSchema = z.object({
  total: z.number().int(),
  ativos: z.number().int(),
  usados: z.number().int(),
  expirados: z.number().int(),
  revogados: z.number().int(),
});
export type InviteSummaryDto = z.infer<typeof inviteSummaryDtoSchema>;

export const inviteListDtoSchema = z.object({ invites: z.array(inviteDtoSchema), summary: inviteSummaryDtoSchema });
export type InviteListDto = z.infer<typeof inviteListDtoSchema>;
