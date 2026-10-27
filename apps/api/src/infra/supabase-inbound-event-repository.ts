import type { SupabaseClient } from '@supabase/supabase-js';
import { ForeignEventError } from '../application/errors.js';
import type { InboundEventRepository, InboundEventStatus } from '../application/ports.js';

const FOREIGN_EVENT = 'evento_de_outro_usuario';

type RegisterRow = { first_time: boolean; status: InboundEventStatus; reply: unknown | null };

export function createSupabaseInboundEventRepository(client: SupabaseClient): InboundEventRepository {
  async function update(
    channel: string,
    externalId: string,
    patch: Record<string, unknown>,
    what: string,
  ): Promise<void> {
    const { data, error } = await client
      .from('inbound_events')
      .update(patch)
      .eq('channel', channel)
      .eq('external_id', externalId)
      .select('id');
    if (error) throw new Error(`Falha ao ${what}: ${error.message}`);
    if ((data ?? []).length === 0) throw new Error(`Falha ao ${what}: evento não encontrado`);
  }

  return {
    async register(userId, channel, externalId, now) {
      const { data, error } = await client.rpc('register_inbound_event', {
        p_user_id: userId,
        p_channel: channel,
        p_external_id: externalId,
        p_now: now.toISOString(),
      });
      if (error) {
        if (error.message.includes(FOREIGN_EVENT)) throw new ForeignEventError();
        throw new Error(`Falha ao registrar evento: ${error.message}`);
      }
      const row = (data as RegisterRow[] | null)?.[0];
      if (!row) throw new Error('Falha ao registrar evento: resposta vazia');
      return { firstTime: row.first_time, status: row.status, reply: row.reply ?? null };
    },

    async beginModelCall(channel, externalId, now) {
      // Incremento otimista: só grava se `attempt_count` ainda é o valor lido.
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: row, error: readError } = await client
          .from('inbound_events')
          .select('attempt_count')
          .eq('channel', channel)
          .eq('external_id', externalId)
          .maybeSingle();
        if (readError) throw new Error(`Falha ao iniciar chamada ao modelo: ${readError.message}`);
        if (!row) throw new Error('Falha ao iniciar chamada ao modelo: evento não encontrado');
        const { data, error } = await client
          .from('inbound_events')
          .update({ status: 'processando', attempt_count: (row.attempt_count as number) + 1 })
          .eq('channel', channel)
          .eq('external_id', externalId)
          .eq('attempt_count', row.attempt_count as number)
          .select('id');
        if (error) throw new Error(`Falha ao iniciar chamada ao modelo: ${error.message}`);
        if ((data ?? []).length > 0) return;
      }
      throw new Error('Falha ao iniciar chamada ao modelo: conflito de atualização');
    },

    async markProcessed(channel, externalId, reply, now) {
      await update(
        channel,
        externalId,
        { status: 'processado', processed_at: now.toISOString(), reply },
        'marcar evento como processado',
      );
    },

    async markFailed(channel, externalId, now) {
      await update(
        channel,
        externalId,
        { status: 'falhou', processed_at: now.toISOString() },
        'marcar evento como falho',
      );
    },

    async countSince(userId, channel, since) {
      const { count, error } = await client
        .from('inbound_events')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('channel', channel)
        .gte('attempt_count', 1)
        .gte('received_at', since.toISOString());
      if (error) throw new Error(`Falha ao contar eventos: ${error.message}`);
      return count ?? 0;
    },
  };
}
