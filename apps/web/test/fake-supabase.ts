import { vi } from "vitest";
import type { AuthClient, AuthSession } from "@/lib/supabase";

type Overrides = {
  session?: AuthSession | null;
  /** Promise que nunca resolve, para simular "carregando". */
  pendingSession?: boolean;
};

/** Cliente Supabase falso: nenhum acesso à rede. */
export function fakeSupabase(o: Overrides = {}) {
  const listeners: Array<(event: string, session: AuthSession | null) => void> = [];
  /** Emite um evento de auth (ex.: PASSWORD_RECOVERY) para quem assinou onAuthStateChange. */
  const emit = (event: string, session: AuthSession | null = o.session ?? null) =>
    listeners.forEach((l) => l(event, session));
  const auth = {
    getSession: vi.fn(() =>
      o.pendingSession
        ? new Promise<never>(() => {})
        : Promise.resolve({ data: { session: o.session ?? null } }),
    ),
    onAuthStateChange: vi.fn((cb: (event: string, session: AuthSession | null) => void) => {
      listeners.push(cb);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signInWithPassword: vi.fn(() =>
      Promise.resolve({ data: { session: null }, error: null as unknown }),
    ),
    resetPasswordForEmail: vi.fn(() =>
      Promise.resolve({ data: {}, error: null as unknown }),
    ),
    updateUser: vi.fn(() => Promise.resolve({ data: {}, error: null as unknown })),
    verifyOtp: vi.fn(() => Promise.resolve({ data: { session: null }, error: null as unknown })),
    signOut: vi.fn(() => Promise.resolve({ error: null as unknown })),
  };
  return { client: { auth } as unknown as AuthClient, auth, emit };
}
