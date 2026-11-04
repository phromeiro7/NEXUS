import type { SupabaseClient } from '@supabase/supabase-js';
import { InviteCodeCollisionError } from '../application/errors.js';
import type { InviteRecord, InviteRepository } from '../application/ports.js';

const UNIQUE_VIOLATION = '23505';

type Row = {
  code: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  used_at: string | null;
  used_by: string | null;
};

const toRecord = (row: Row): InviteRecord => ({
  code: row.code,
  createdBy: row.created_by,
  createdAt: new Date(row.created_at),
  expiresAt: new Date(row.expires_at),
  revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
  usedAt: row.used_at === null ? null : new Date(row.used_at),
  usedBy: row.used_by,
});

export function createSupabaseInviteRepository(client: SupabaseClient): InviteRepository {
  return {
    async create(createdBy, code, createdAt, expiresAt) {
      const { error } = await client.from('invites').insert({
        code,
        created_by: createdBy,
        created_at: createdAt.toISOString(),
        expires_at: expiresAt.toISOString(),
      });
      if (error?.code === UNIQUE_VIOLATION) throw new InviteCodeCollisionError();
      if (error) throw new Error(`Falha ao gravar convite: ${error.message}`);
    },

    async list(limit) {
      const { data, error } = await client
        .from('invites')
        .select('code, created_by, created_at, expires_at, revoked_at, used_at, used_by')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(`Falha ao listar convites: ${error.message}`);
      return ((data ?? []) as Row[]).map(toRecord);
    },

    async revoke(code, now) {
      const { data, error } = await client
        .from('invites')
        .update({ revoked_at: now.toISOString() })
        .eq('code', code)
        .is('used_at', null)
        .is('revoked_at', null)
        .select('code');
      if (error) throw new Error(`Falha ao revogar convite: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async find(code) {
      const { data, error } = await client
        .from('invites')
        .select('code, created_by, created_at, expires_at, revoked_at, used_at, used_by')
        .eq('code', code)
        .maybeSingle();
      if (error) throw new Error(`Falha ao buscar convite: ${error.message}`);
      return data ? toRecord(data as Row) : null;
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
      const id = data?.telegram_chat_id as number | string | null | undefined;
      return id === null || id === undefined ? null : Number(id);
    },
  };
}
