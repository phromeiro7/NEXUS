import type { SupabaseClient } from '@supabase/supabase-js';
import type { QrLoginRecord, QrLoginRepository } from '../application/ports.js';

/** Linha devolvida pela RPC `open_qr_login`. */
type OpenRow = { id: string; outcome: 'confirmar' | 'recusado'; client_label: string; created_at: string };

/** Linha de `qr_login_requests` lida por `get`. */
type QrLoginRow = {
  id: string;
  status: QrLoginRecord['status'];
  poll_hash: string;
  created_at: string;
  expires_at: string;
};

/** Pedidos de login por QR (qr_login_requests). Nunca registra segredos, nem os hashes. */
export function createSupabaseQrLoginRepository(client: SupabaseClient): QrLoginRepository {
  return {
    async create(input) {
      const { error } = await client.from('qr_login_requests').insert({
        id: input.id,
        nonce_hash: input.nonceHash,
        poll_hash: input.pollHash,
        client_label: input.clientLabel,
        created_at: input.createdAt.toISOString(),
        expires_at: input.expiresAt.toISOString(),
      });
      if (error) throw new Error(`Falha ao criar o pedido de login: ${error.message}`);
    },

    async get(id) {
      const { data, error } = await client
        .from('qr_login_requests')
        .select('id, status, poll_hash, created_at, expires_at')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`Falha ao ler o pedido de login: ${error.message}`);
      if (data === null) return null;
      const row = data as QrLoginRow;
      return {
        id: row.id,
        status: row.status,
        pollHash: row.poll_hash,
        createdAt: new Date(row.created_at),
        expiresAt: new Date(row.expires_at),
      };
    },

    // As transições (abrir, decidir, recolher, devolver) são RPCs atômicas: o pedido muda de estado
    // uma única vez, mesmo com o navegador consultando e o bot respondendo ao mesmo tempo.
    async open(nonceHash, chatId, userId, now) {
      const { data, error } = await client.rpc('open_qr_login', {
        p_nonce_hash: nonceHash,
        p_chat_id: chatId,
        p_user_id: userId,
        p_now: now.toISOString(),
      });
      if (error) throw new Error(`Falha ao abrir o pedido de login: ${error.message}`);
      const row = (data as OpenRow[] | null)?.[0];
      if (!row) return null;
      return { id: row.id, outcome: row.outcome, clientLabel: row.client_label, createdAt: new Date(row.created_at) };
    },

    async decide(id, chatId, userId, approve, now) {
      const { data, error } = await client.rpc('decide_qr_login', {
        p_id: id,
        p_chat_id: chatId,
        p_user_id: userId,
        p_approve: approve,
        p_now: now.toISOString(),
      });
      if (error) throw new Error(`Falha ao decidir o pedido de login: ${error.message}`);
      return data === 'aprovado' || data === 'negado' ? data : null;
    },

    async consume(id, pollHash, now) {
      const { data, error } = await client.rpc('consume_qr_login', {
        p_id: id,
        p_poll_hash: pollHash,
        p_now: now.toISOString(),
      });
      if (error) throw new Error(`Falha ao recolher o pedido de login: ${error.message}`);
      return typeof data === 'string' ? data : null;
    },

    async release(id) {
      const { error } = await client.rpc('release_qr_login', { p_id: id });
      if (error) throw new Error(`Falha ao devolver o pedido de login: ${error.message}`);
    },

    async purgeExpired(now) {
      const { data, error } = await client.rpc('purge_qr_login_requests', { p_now: now.toISOString() });
      if (error) throw new Error(`Falha ao limpar pedidos de login: ${error.message}`);
      return (data as number | null) ?? 0;
    },
  };
}
