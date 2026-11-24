import type { SupabaseClient } from '@supabase/supabase-js';
import { InviteCodeCollisionError } from '../application/errors.js';
import type { InviteRecord, InviteRepository } from '../application/ports.js';

/** SQLSTATE `unique_violation`: o código sorteado já existe. */
const UNIQUE_VIOLATION = '23505';

const INVITE_COLUMNS = 'code, created_by, created_at, expires_at, revoked_at, used_at, used_by, label';

/** Linha de `invites`. */
type InviteRow = {
  code: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  used_at: string | null;
  used_by: string | null;
  label: string | null;
};

const toRecord = (row: InviteRow): InviteRecord => ({
  code: row.code,
  createdBy: row.created_by,
  createdAt: new Date(row.created_at),
  expiresAt: new Date(row.expires_at),
  revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
  usedAt: row.used_at === null ? null : new Date(row.used_at),
  usedBy: row.used_by,
  label: row.label,
});

/**
 * Convites de acesso. Reservar, concluir e devolver um convite são RPCs atômicas no banco:
 * dois aceites simultâneos do mesmo código nunca criam duas contas.
 */
export function createSupabaseInviteRepository(client: SupabaseClient): InviteRepository {
  return {
    async create(createdBy, code, createdAt, expiresAt, label) {
      const { error } = await client.from('invites').insert({
        code,
        created_by: createdBy,
        created_at: createdAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        ...(label !== undefined ? { label } : {}),
      });
      if (error?.code === UNIQUE_VIOLATION) throw new InviteCodeCollisionError();
      if (error) throw new Error(`Falha ao gravar convite: ${error.message}`);
    },

    async list(limit) {
      const { data, error } = await client
        .from('invites')
        .select(INVITE_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(`Falha ao listar convites: ${error.message}`);
      return ((data ?? []) as InviteRow[]).map(toRecord);
    },

    async revoke(code, now) {
      const { data, error } = await client
        .from('invites')
        .update({ revoked_at: now.toISOString() })
        .eq('code', code)
        // Só convite ainda aberto pode ser revogado (nem usado, nem já revogado).
        .is('used_at', null)
        .is('revoked_at', null)
        .select('code');
      if (error) throw new Error(`Falha ao revogar convite: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async find(code) {
      const { data, error } = await client
        .from('invites')
        .select(INVITE_COLUMNS)
        .eq('code', code)
        .maybeSingle();
      if (error) throw new Error(`Falha ao buscar convite: ${error.message}`);
      return data ? toRecord(data as InviteRow) : null;
    },

    async remove(code) {
      const { data, error } = await client.from('invites').delete().eq('code', code).select('code');
      if (error) throw new Error(`Falha ao apagar convite: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async claim(code, now) {
      const { data, error } = await client.rpc('claim_invite', { p_code: code, p_now: now.toISOString() });
      if (error) throw new Error(`Falha ao reservar convite: ${error.message}`);
      return data === true;
    },

    async finish(code, userId, now) {
      const { data, error } = await client.rpc('finish_invite', {
        p_code: code,
        p_user_id: userId,
        p_now: now.toISOString(),
      });
      if (error) throw new Error(`Falha ao concluir convite: ${error.message}`);
      return data === true;
    },

    async release(code) {
      const { error } = await client.rpc('release_invite', { p_code: code });
      if (error) throw new Error(`Falha ao devolver convite: ${error.message}`);
    },

    async telegramIdOf(userId) {
      const { data, error } = await client.from('profiles').select('telegram_chat_id').eq('id', userId).maybeSingle();
      if (error) throw new Error(`Falha ao buscar o Telegram da conta: ${error.message}`);
      // Em chat privado o id do chat é o id do usuário no Telegram; bigint pode chegar como string.
      const telegramChatId = data?.telegram_chat_id as number | string | null | undefined;
      return telegramChatId === null || telegramChatId === undefined ? null : Number(telegramChatId);
    },
  };
}
