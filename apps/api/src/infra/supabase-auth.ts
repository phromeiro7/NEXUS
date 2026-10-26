import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthVerifier } from '../auth.js';

export function createSupabaseAuthVerifier(client: SupabaseClient): AuthVerifier {
  return async (token) => {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return null;
    return { userId: data.user.id };
  };
}
