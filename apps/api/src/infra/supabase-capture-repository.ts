import type { SupabaseClient } from '@supabase/supabase-js';
import type { CaptureEntity, CaptureRecord, CaptureRepository, CaptureStatus } from '../application/ports.js';

const HOUR_MS = 60 * 60 * 1000;
/** Proposta pendente vale 1 hora; depois de confirmada, o "desfazer" fica disponível por 24 horas. */
const PENDING_CAPTURE_TTL_MS = HOUR_MS;
const UNDO_WINDOW_MS = 24 * HOUR_MS;
/** Id malformado nunca chega ao banco (daria erro 22P02): é tratado como "não encontrado". */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Linha de `chat_captures`; bigint (chat e mensagem) pode chegar como string. */
type CaptureRow = {
  id: string;
  user_id: string;
  chat_id: number | string;
  payload: unknown;
  status: CaptureStatus;
  entity_kind: 'tarefa' | 'lancamento' | null;
  entity_id: string | null;
  message_id: number | string | null;
  expires_at: string;
};

const COLUMNS = 'id, user_id, chat_id, payload, status, entity_kind, entity_id, message_id, expires_at';

function toRecord(row: CaptureRow): CaptureRecord {
  return {
    id: row.id,
    userId: row.user_id,
    chatId: Number(row.chat_id),
    payload: row.payload,
    status: row.status,
    entity: row.entity_kind !== null && row.entity_id !== null ? { kind: row.entity_kind, id: row.entity_id } : null,
    messageId: row.message_id === null ? null : Number(row.message_id),
    expiresAt: new Date(row.expires_at),
  };
}

/**
 * Propostas do chat. Toda troca de estado é um `update ... where status = <esperado> returning`, ou seja,
 * uma comparação e troca atômica no banco: de dois toques simultâneos, só um recebe a linha de volta.
 */
export function createSupabaseCaptureRepository(client: SupabaseClient): CaptureRepository {
  const table = () => client.from('chat_captures');

  /** Troca atômica; devolve a linha atualizada ou `null` se o estado esperado já não valia. */
  async function transition(
    id: string,
    expectedStatus: CaptureStatus,
    patch: Record<string, unknown>,
    actionDescription: string,
  ): Promise<CaptureRow | null> {
    if (!UUID_PATTERN.test(id)) return null;
    const { data, error } = await table().update(patch).eq('id', id).eq('status', expectedStatus).select(COLUMNS);
    if (error) throw new Error(`Falha ao ${actionDescription}: ${error.message}`);
    return ((data ?? []) as CaptureRow[])[0] ?? null;
  }

  return {
    async create(userId, chatId, payload, now) {
      const { data, error } = await table()
        .insert({
          user_id: userId,
          chat_id: chatId,
          payload,
          expires_at: new Date(now.getTime() + PENDING_CAPTURE_TTL_MS).toISOString(),
        })
        .select(COLUMNS)
        .single();
      if (error) throw new Error(`Falha ao gravar a proposta: ${error.message}`);
      return toRecord(data as CaptureRow);
    },

    async get(id, now) {
      if (!UUID_PATTERN.test(id)) return null;
      // Só devolve proposta ainda válida; a expirada é como se não existisse.
      const { data, error } = await table().select(COLUMNS).eq('id', id).gt('expires_at', now.toISOString()).maybeSingle();
      if (error) throw new Error(`Falha ao ler a proposta: ${error.message}`);
      return data === null ? null : toRecord(data as CaptureRow);
    },

    async updatePayload(id, payload) {
      return (await transition(id, 'pendente', { payload }, 'atualizar a proposta')) !== null;
    },

    async setMessage(id, messageId) {
      if (!UUID_PATTERN.test(id)) return;
      const { error } = await table().update({ message_id: messageId }).eq('id', id);
      if (error) throw new Error(`Falha ao guardar a mensagem da proposta: ${error.message}`);
    },

    async beginConfirm(id, now) {
      const row = await transition(id, 'pendente', { status: 'confirmando' }, 'reservar a confirmação');
      // Proposta expirada não pode mais ser confirmada, mesmo que ainda não tenha sido apagada.
      const isExpired = row !== null && new Date(row.expires_at).getTime() < now.getTime();
      if (isExpired) {
        await transition(id, 'confirmando', { status: 'pendente' }, 'devolver a proposta expirada');
        return false;
      }
      return row !== null;
    },

    async finishConfirm(id, entity: CaptureEntity, now) {
      const row = await transition(
        id,
        'confirmando',
        {
          status: 'confirmada',
          entity_kind: entity.kind,
          entity_id: entity.id,
          expires_at: new Date(now.getTime() + UNDO_WINDOW_MS).toISOString(),
        },
        'concluir a confirmação',
      );
      if (row === null) throw new Error('Falha ao concluir a confirmação: proposta fora do estado esperado');
    },

    async abortConfirm(id) {
      await transition(id, 'confirmando', { status: 'pendente' }, 'devolver a proposta');
    },

    async beginUndo(id, now) {
      const row = await transition(id, 'confirmada', { status: 'desfeita' }, 'reservar o desfazer');
      if (row === null) return null;
      // Fora da janela do desfazer, ou sem o registro criado: devolve ao estado anterior.
      const isExpired = new Date(row.expires_at).getTime() < now.getTime();
      if (isExpired || row.entity_kind === null || row.entity_id === null) {
        await transition(id, 'desfeita', { status: 'confirmada' }, 'devolver a proposta');
        return null;
      }
      return { kind: row.entity_kind, id: row.entity_id };
    },

    async abortUndo(id) {
      await transition(id, 'desfeita', { status: 'confirmada' }, 'devolver a proposta');
    },

    async purgeExpired(now) {
      const { data, error } = await client.rpc('purge_expired_chat_captures', { p_now: now.toISOString() });
      if (error) throw new Error(`Falha ao limpar propostas expiradas: ${error.message}`);
      return (data as number | null) ?? 0;
    },
  };
}
