import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthVerifier } from '../auth.js';

/** Valida o JWT do Supabase Auth e devolve o usuário; token inválido ou conta bloqueada viram `null` (401). */
export function createSupabaseAuthVerifier(client: SupabaseClient): AuthVerifier {
  return async (token) => {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return null;
    // Conta bloqueada por um administrador: o token ainda é válido, mas o acesso acabou.
    const bannedUntil = data.user.banned_until;
    if (bannedUntil && Date.parse(bannedUntil) > Date.now()) return null;
    return { userId: data.user.id };
  };
}
