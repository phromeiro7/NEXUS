import type { SupabaseClient } from '@supabase/supabase-js';
import { EventStateError, ForeignEventError } from '../application/errors.js';
import type { InboundEventRepository, InboundEventStatus } from '../application/ports.js';

type RegisterRow = { first_time: boolean; status: InboundEventStatus; reply: unknown | null };

/** Maps the typed SQL exceptions of the register/begin functions; anything else is a plain failure. */
function mapDbError(message: string, what: string): Error {
  if (message.includes('evento_de_outro_usuario')) return new ForeignEventError();
  if (message.includes('evento_em_estado_invalido')) return new EventStateError('evento_em_estado_invalido');
  if (message.includes('evento_inexistente')) return new EventStateError('evento_inexistente');
  if (message.includes('usuario_obrigatorio')) return new EventStateError('usuario_obrigatorio');
  return new Error(`Falha ao ${what}: ${message}`);
}

export function createSupabaseInboundEventRepository(client: SupabaseClient): InboundEventRepository {
  /**
   * Conditional update scoped by owner (`user_id = userId`, or `is null`), channel, external id
   * and the allowed current statuses. Zero rows -> a read classifies why (missing, another
   * user's, or wrong state) and a typed error is thrown; never a silent success.
   */
  async function transition(
    userId: string | null,
    channel: string,
    externalId: string,
    from: InboundEventStatus[],
    patch: Record<string, unknown>,
    what: string,
  ): Promise<void> {
    const base = client.from('inbound_events').update(patch).eq('channel', channel).eq('external_id', externalId);
    const scoped = userId === null ? base.is('user_id', null) : base.eq('user_id', userId);
    const { data, error } = await scoped.in('status', from).select('id');
    if (error) throw new Error(`Falha ao ${what}: ${error.message}`);
    if ((data ?? []).length > 0) return;

    const { data: existing, error: readError } = await client
      .from('inbound_events')
      .select('user_id')
      .eq('channel', channel)
      .eq('external_id', externalId)
      .maybeSingle();
    if (readError) throw new Error(`Falha ao ${what}: ${readError.message}`);
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
