import type { SupabaseClient } from '@supabase/supabase-js';
import { EventStateError, ForeignEventError } from '../application/errors.js';
import type { InboundEventRepository, InboundEventStatus } from '../application/ports.js';

/** Linha devolvida pela RPC `register_inbound_event`. */
type RegisterRow = { first_time: boolean; status: InboundEventStatus; reply: unknown | null };

/** Converte as exceções tipadas das funções SQL de registro/início; qualquer outra vira falha genérica. */
function mapDbError(message: string, actionDescription: string): Error {
  if (message.includes('evento_de_outro_usuario')) return new ForeignEventError();
  if (message.includes('evento_em_estado_invalido')) return new EventStateError('evento_em_estado_invalido');
  if (message.includes('evento_inexistente')) return new EventStateError('evento_inexistente');
  if (message.includes('usuario_obrigatorio')) return new EventStateError('usuario_obrigatorio');
  return new Error(`Falha ao ${actionDescription}: ${message}`);
}

/**
 * Eventos recebidos (mensagens do chat/painel), para processar cada um uma única vez e
 * contar as chamadas ao modelo por usuário (limite de uso).
 */
export function createSupabaseInboundEventRepository(client: SupabaseClient): InboundEventRepository {
  /**
   * Update condicional restrito ao dono (`user_id = userId`, ou `is null`), canal, id externo e
   * estados atuais permitidos. Nenhuma linha afetada -> uma leitura descobre o motivo (inexistente,
   * de outro usuário ou estado errado) e lança o erro tipado; nunca um sucesso silencioso.
   */
  async function transition(
    userId: string | null,
    channel: string,
    externalId: string,
    allowedStatuses: InboundEventStatus[],
    patch: Record<string, unknown>,
    actionDescription: string,
  ): Promise<void> {
    const baseUpdate = client.from('inbound_events').update(patch).eq('channel', channel).eq('external_id', externalId);
    // `eq('user_id', null)` não casa com NULL no SQL: evento sem dono precisa de `is null`.
    const ownerScopedUpdate = userId === null ? baseUpdate.is('user_id', null) : baseUpdate.eq('user_id', userId);
    const { data, error } = await ownerScopedUpdate.in('status', allowedStatuses).select('id');
    if (error) throw new Error(`Falha ao ${actionDescription}: ${error.message}`);
    if ((data ?? []).length > 0) return;

    const { data: existing, error: readError } = await client
      .from('inbound_events')
      .select('user_id')
      .eq('channel', channel)
      .eq('external_id', externalId)
      .maybeSingle();
    if (readError) throw new Error(`Falha ao ${actionDescription}: ${readError.message}`);
    if (!existing) throw new EventStateError('evento_inexistente');
    if ((existing.user_id as string | null) !== userId) throw new ForeignEventError();
    throw new EventStateError('evento_em_estado_invalido');
  }

  return {
    async register(userId, channel, externalId, now) {
      const { data, error } = await client.rpc('register_inbound_event', {
        p_user_id: userId,
        p_channel: channel,
        p_external_id: externalId,
        p_now: now.toISOString(),
      });
      if (error) throw mapDbError(error.message, 'registrar evento');
      const row = (data as RegisterRow[] | null)?.[0];
      if (!row) throw new Error('Falha ao registrar evento: resposta vazia');
      return { firstTime: row.first_time, status: row.status, reply: row.reply ?? null };
    },

    async beginModelCall(userId, channel, externalId, now) {
      if (userId === null || userId === undefined) throw new EventStateError('usuario_obrigatorio');
      const { error } = await client.rpc('begin_model_call', {
        p_user_id: userId,
        p_channel: channel,
        p_external_id: externalId,
        p_now: now.toISOString(),
      });
      if (error) throw mapDbError(error.message, 'iniciar chamada ao modelo');
    },

    async markProcessed(userId, channel, externalId, reply, now) {
      await transition(
        userId,
        channel,
        externalId,
        ['processando'],
        { status: 'processado', processed_at: now.toISOString(), reply },
        'marcar evento como processado',
      );
    },

    async markFailed(userId, channel, externalId, now) {
      await transition(
        userId,
        channel,
        externalId,
        ['recebido', 'processando'],
        { status: 'falhou', processed_at: now.toISOString() },
        'marcar evento como falho',
      );
    },

    // Só a contagem (`head: true`), sem trazer linhas.
    async countSince(userId, since) {
      const { count, error } = await client
        .from('assistant_model_calls')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('called_at', since.toISOString());
      if (error) throw new Error(`Falha ao contar chamadas ao modelo: ${error.message}`);
      return count ?? 0;
    },
  };
}
