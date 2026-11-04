import { createClient } from "@supabase/supabase-js";

export type AuthSession = {
  access_token: string;
  user?: { id: string; user_metadata?: { display_name?: unknown } };
};

export type AuthApiError = { code?: string; status?: number; message?: string };

type AuthResponse = {
  data: { session: AuthSession | null };
  error: AuthApiError | null;
};

/** Parte do cliente Supabase que o painel usa: somente `auth`. */
export type AuthClient = {
  auth: {
    getSession(): Promise<{ data: { session: AuthSession | null } }>;
    onAuthStateChange(cb: (event: string, session: AuthSession | null) => void): {
      data: { subscription: { unsubscribe(): void } };
    };
    signInWithPassword(c: { email: string; password: string }): Promise<AuthResponse>;
    signUp(c: { email: string; password: string }): Promise<AuthResponse>;
    resetPasswordForEmail(
      email: string,
      o?: { redirectTo?: string },
    ): Promise<{ error: AuthApiError | null }>;
    updateUser(attrs: {
      password?: string;
      data?: { display_name: string | null };
    }): Promise<{ error: AuthApiError | null }>;
    signOut(o?: { scope: "local" | "global" | "others" }): Promise<{ error: AuthApiError | null }>;
  };
};

export type SupabaseEnv = { url?: string; anonKey?: string };

/** Referências estáticas: o Next só embute `NEXT_PUBLIC_*` assim. Lidas sob demanda. */
export function readSupabaseEnv(): SupabaseEnv {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function readApiUrl(value: string | undefined = process.env.NEXT_PUBLIC_API_URL): string {
  return value !== undefined && value !== "" ? value : "http://localhost:3001";
}

/** Valida as variáveis só ao criar o cliente (nunca na importação). */
export function createSupabase(env: SupabaseEnv = readSupabaseEnv()): AuthClient {
  if (!env.url) {
    throw new Error("Variável de ambiente ausente: NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!env.anonKey) {
    throw new Error("Variável de ambiente ausente: NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient(env.url, env.anonKey) as unknown as AuthClient;
}
