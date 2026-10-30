import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { createSupabaseBriefingRepository } from '../../src/infra/supabase-briefing-repository.js';
import { closePool, createUser, deleteCreatedUsers, pool } from './helpers.js';
import { getSupabaseEnv } from './supabase-env.js';

const env = getSupabaseEnv();
const admin: SupabaseClient = createClient(env.url, env.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const briefings = createSupabaseBriefingRepository(admin);

afterAll(async () => {
  await deleteCreatedUsers();
  await closePool();
});

let chatSeq = 0;
const newChatId = (): number => 7_100_000_000 + Math.floor(Math.random() * 1_000_000_000) * 10 + (chatSeq++ % 10);

async function mkUser(
  o: { timezone?: string; briefingTime?: string; chat?: number | null; paused?: boolean; last?: string | null } = {},
) {
  const id = await createUser();
  const chat = o.chat === undefined ? newChatId() : o.chat;
  await pool.query(
    `update public.profiles
        set telegram_chat_id = $2, channel_paused = $3, timezone = $4, briefing_time = $5, last_briefing_sent_on = $6
      where id = $1`,
    [id, chat, o.paused ?? false, o.timezone ?? 'America/Sao_Paulo', o.briefingTime ?? '08:00', o.last ?? null],
  );
  return { id, chat };
}

const lastSent = async (id: string): Promise<string | null> => {
  const r = await pool.query(`select last_briefing_sent_on::text as d from public.profiles where id = $1`, [id]);
  return (r.rows[0] as { d: string | null }).d;
};

/** Só os usuários deste teste: o banco local pode ter perfis reais. */
const dueOf = async (now: Date, ids: string[]) => (await briefings.dueFor(now)).filter((r) => ids.includes(r.userId));

// 2031: nenhum perfil de desenvolvimento real tem last_briefing_sent_on tão adiante.
const AT_0800_SP = new Date('2031-05-12T11:00:00Z'); // 08:00 em São Paulo (UTC-3)

describe('briefing repository (real DB)', () => {
  it('dueFor: two time zones, each with its own local date and window', async () => {
    const sp = await mkUser({ timezone: 'America/Sao_Paulo' });
    const akl = await mkUser({ timezone: 'Pacific/Auckland' });
    // 2031-05-12T11:00Z = 08:00 SP (12/05) e 23:00 Auckland (NZST UTC+12, 12/05): fora da janela das 08:00
    expect(await dueOf(AT_0800_SP, [sp.id, akl.id])).toEqual([
      { userId: sp.id, chatId: sp.chat, timezone: 'America/Sao_Paulo', localDate: '2031-05-12' },
    ]);
    // 2031-05-12T20:00Z = 17:00 SP (fora) e 08:00 de 13/05 em Auckland: data LOCAL do dia seguinte
    expect(await dueOf(new Date('2031-05-12T20:00:00Z'), [sp.id, akl.id])).toEqual([
      { userId: akl.id, chatId: akl.chat, timezone: 'Pacific/Auckland', localDate: '2031-05-13' },
    ]);
  });

  it('dueFor: window edges (07:59 no, 08:00 yes, 12:00 yes, 12:01 no)', async () => {
    const u = await mkUser();
    const t = (iso: string) => dueOf(new Date(iso), [u.id]);
    expect(await t('2031-05-12T10:59:00Z')).toEqual([]);
    expect((await t('2031-05-12T11:00:00Z')).map((r) => r.localDate)).toEqual(['2031-05-12']);
    expect((await t('2031-05-12T15:00:00Z')).map((r) => r.localDate)).toEqual(['2031-05-12']);
    expect(await t('2031-05-12T15:01:00Z')).toEqual([]);
  });

  it('dueFor: window crossing local midnight uses the date of briefing_time', async () => {
    const u = await mkUser({ briefingTime: '22:00' });
    const rows = await dueOf(new Date('2031-05-13T03:30:00Z'), [u.id]); // 00:30 de 13/05 em SP
    expect(rows.map((r) => r.localDate)).toEqual(['2031-05-12']);
  });

  it('dueFor: unlinked, paused and already-sent profiles are never due', async () => {
    const unlinked = await mkUser({ chat: null });
    const paused = await mkUser({ paused: true });
    const sentToday = await mkUser({ last: '2031-05-12' });
    const sentYesterday = await mkUser({ last: '2031-05-11' });
    const ids = [unlinked.id, paused.id, sentToday.id, sentYesterday.id];
    expect((await dueOf(AT_0800_SP, ids)).map((r) => r.userId)).toEqual([sentYesterday.id]);
  });

  it('dueFor: a DST-gap briefing time does not crash', async () => {
    const u = await mkUser({ timezone: 'America/New_York', briefingTime: '02:30' });
    const rows = await dueOf(new Date('2031-03-09T07:30:00Z'), [u.id]); // 2031-03-09 03:30 EDT (salto 02:00 -> 03:00)
    expect(rows.map((r) => r.localDate)).toEqual(['2031-03-09']);
  });

  it('dueFor: a profile with an invalid time zone is skipped and logged; the others are still returned', async () => {
    const bad = await mkUser({ timezone: 'Nowhere/Land' });
    const good = await mkUser();
    const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const repo = createSupabaseBriefingRepository(admin, {
      logger: { info: () => {}, error: (event, fields) => logs.push({ event, fields }) },
    });
    const rows = (await repo.dueFor(AT_0800_SP)).filter((r) => [bad.id, good.id].includes(r.userId));
    expect(rows.map((r) => r.userId)).toEqual([good.id]);
    const mine = logs.filter((l) => l.fields.userId === bad.id);
    expect(mine).toEqual([
      { event: 'briefing.invalid_profile', fields: { userId: bad.id, errorName: 'RangeError' } },
    ]);
  });

  it('dueFor pages the candidates: every due user exactly once, in stable id order (pageSize 2)', async () => {
    const users = [];
    for (let i = 0; i < 5; i += 1) users.push(await mkUser());
    const ids = users.map((u) => u.id);
    const paged = createSupabaseBriefingRepository(admin, { pageSize: 2 });
    const got = (await paged.dueFor(AT_0800_SP)).map((r) => r.userId).filter((id) => ids.includes(id));
    expect(got).toEqual([...ids].sort());
  });

  it('dueFor pages correctly when the due users are exactly a multiple of the page size', async () => {
    // Todos os perfis do banco local entram nos candidatos; pageSize = total de candidatos força o limite exato.
    const u = await mkUser();
    const total = Number(
      (await pool.query(`select count(*)::int as n from public.profiles where telegram_chat_id is not null and not channel_paused`))
        .rows[0].n,
    );
    const paged = createSupabaseBriefingRepository(admin, { pageSize: total });
    const got = (await paged.dueFor(AT_0800_SP)).map((r) => r.userId);
    expect(got).toContain(u.id);
    expect(new Set(got).size).toBe(got.length);
  });

  it('claim: true once, false afterwards; dueFor stops returning the user', async () => {
    const u = await mkUser();
    expect(await briefings.claim(u.id, '2031-05-12' as never)).toBe(true);
    expect(await lastSent(u.id)).toBe('2031-05-12');
    expect(await briefings.claim(u.id, '2031-05-12' as never)).toBe(false);
    expect(await briefings.claim(u.id, '2031-05-11' as never)).toBe(false);
    expect(await dueOf(AT_0800_SP, [u.id])).toEqual([]);
    expect(await briefings.claim(u.id, '2031-05-13' as never)).toBe(true);
  });

  it('simultaneous claims: exactly one true', async () => {
    const u = await mkUser();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => briefings.claim(u.id, '2031-05-12' as never)),
    );
    expect(results.filter((r) => r === true)).toHaveLength(1);
  });

  it('release: restores the previous day only when the stored day equals localDate', async () => {
    const u = await mkUser();
    await briefings.claim(u.id, '2031-05-12' as never);
    await briefings.release(u.id, '2031-05-11' as never);
    expect(await lastSent(u.id)).toBe('2031-05-12');
    await briefings.release(u.id, '2031-05-12' as never);
    expect(await lastSent(u.id)).toBe('2031-05-11');
    expect((await dueOf(AT_0800_SP, [u.id])).map((r) => r.userId)).toEqual([u.id]);
    expect(await briefings.claim(u.id, '2031-05-12' as never)).toBe(true);
  });

  it('claim and release only touch the given user', async () => {
    const a = await mkUser();
    const b = await mkUser();
    await briefings.claim(a.id, '2031-05-12' as never);
    expect(await lastSent(b.id)).toBeNull();
    await briefings.release(b.id, '2031-05-12' as never);
    expect(await lastSent(a.id)).toBe('2031-05-12');
  });
});
