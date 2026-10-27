"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createApiClient } from "@/lib/api";
import { createSupabase, readApiUrl, type AuthApiError, type AuthClient } from "@/lib/supabase";

export type AuthStatus = "loading" | "signedIn" | "signedOut";

export type AuthResult = { error: string | null };
export type SignUpResult = AuthResult & { needsConfirmation: boolean };

export type AuthContextValue = {
  status: AuthStatus;
  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(email: string, password: string): Promise<SignUpResult>;
  sendReset(email: string): Promise<AuthResult>;
  signOut(): Promise<void>;
  getToken(): Promise<string | null>;
  /** Redireciona para /entrar?next=<rota atual>, no máximo uma vez por sessão deslogada. */
  redirectToLogin(): void;
  api: ReturnType<typeof createApiClient>;
  configError: string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const GENERIC = "Não foi possível concluir. Tente novamente.";

function isInvalidCredentials(e: AuthApiError): boolean {
  return e.code === "invalid_credentials" || /invalid login credentials/i.test(e.message ?? "");
}

function loginMessage(e: AuthApiError): string {
  if (isInvalidCredentials(e)) return "E-mail ou senha incorretos.";
  if (e.code === "email_not_confirmed") return "Confirme seu e-mail antes de entrar.";
  if (e.status === 429 || e.code === "over_request_rate_limit") {
    return "Muitas tentativas. Aguarde um pouco e tente novamente.";
  }
  return GENERIC;
}

function signUpMessage(e: AuthApiError): string {
  if (e.code === "weak_password") return "A senha deve ter pelo menos 8 caracteres.";
  if (e.status === 429 || e.code === "over_request_rate_limit") {
    return "Muitas tentativas. Aguarde um pouco e tente novamente.";
  }
  return "Não foi possível criar a conta com esses dados.";
}

type ProviderProps = {
  children: ReactNode;
  /** Injeção para testes; em produção o cliente é criado no navegador, sob demanda. */
  client?: AuthClient;
  apiFetch?: typeof fetch;
  apiBaseUrl?: string;
};

export function AuthProvider({ children, client: injected, apiFetch, apiBaseUrl }: ProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [configError, setConfigError] = useState<string | null>(null);
  const clientRef = useRef<AuthClient | null>(injected ?? null);
  const redirected = useRef(false);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    let client = injected ?? clientRef.current;
    if (!client) {
      try {
        client = createSupabase();
      } catch (e) {
        setConfigError(e instanceof Error ? e.message : String(e));
        setStatus("signedOut");
        return;
      }
    }
    clientRef.current = client;
    let active = true;
    const apply = (hasSession: boolean) => {
      if (!active) return;
      if (hasSession) redirected.current = false;
      setStatus(hasSession ? "signedIn" : "signedOut");
    };
    void client.auth
      .getSession()
      .then(({ data }) => apply(data.session !== null))
      .catch(() => apply(false));
    const { data } = client.auth.onAuthStateChange((_event, session) => apply(session !== null));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [injected]);

  const getToken = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const redirectToLogin = useCallback(() => {
    if (redirected.current) return;
    redirected.current = true;
    const path = pathRef.current ?? "/";
    const here = typeof window === "undefined" ? "" : window.location.search;
    const onAuthPage = /^\/(entrar|cadastro|recuperar)(\/|$)/.test(path);
    routerRef.current.replace(
      onAuthPage ? "/entrar" : `/entrar?next=${encodeURIComponent(path + here)}`,
    );
  }, []);

  const signOut = useCallback(async () => {
    setStatus("signedOut");
    try {
      await clientRef.current?.auth.signOut({ scope: "local" });
    } catch {
      // sessão local já descartada na interface
    }
  }, []);

  const onUnauthorized = useCallback(() => {
    void signOut();
    redirectToLogin();
  }, [signOut, redirectToLogin]);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: apiBaseUrl ?? readApiUrl(),
        getToken,
        onUnauthorized,
        ...(apiFetch ? { fetch: apiFetch } : {}),
      }),
    [apiBaseUrl, apiFetch, getToken, onUnauthorized],
  );

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const client = clientRef.current;
    if (!client) return { error: GENERIC };
    try {
      const { error } = await client.auth.signInWithPassword({ email, password });
      return { error: error ? loginMessage(error) : null };
    } catch {
      return { error: "Sem conexão. Verifique sua internet e tente novamente." };
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<SignUpResult> => {
    const client = clientRef.current;
    if (!client) return { error: GENERIC, needsConfirmation: false };
    try {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) return { error: signUpMessage(error), needsConfirmation: false };
      return { error: null, needsConfirmation: data.session === null };
    } catch {
      return {
        error: "Sem conexão. Verifique sua internet e tente novamente.",
        needsConfirmation: false,
      };
    }
  }, []);

  const sendReset = useCallback(async (email: string): Promise<AuthResult> => {
    const client = clientRef.current;
    if (!client) return { error: GENERIC };
    try {
      const { error } = await client.auth.resetPasswordForEmail(email);
      if (error && (error.status === 429 || error.code === "over_request_rate_limit")) {
        return { error: "Muitas tentativas. Aguarde um pouco e tente novamente." };
      }
      // Resposta neutra: não revela se a conta existe.
      return { error: null };
    } catch {
      return { error: "Sem conexão. Verifique sua internet e tente novamente." };
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, signIn, signUp, sendReset, signOut, getToken, redirectToLogin, api, configError }),
    [status, signIn, signUp, sendReset, signOut, getToken, redirectToLogin, api, configError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}

/** Cliente da API já ligado ao token e ao tratamento de 401. */
export function useApi() {
  return useAuth().api;
}
