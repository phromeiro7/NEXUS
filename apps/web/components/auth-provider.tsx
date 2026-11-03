"use client";

import type { QueryClient } from "@tanstack/react-query";
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
  /** Sessão aberta pelo link de recuperação de senha (evento PASSWORD_RECOVERY). */
  recovery: boolean;
  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(email: string, password: string): Promise<SignUpResult>;
  sendReset(email: string): Promise<AuthResult>;
  /** Define a nova senha da sessão atual (a de recuperação, vinda do link do e-mail). */
  updatePassword(password: string): Promise<AuthResult>;
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

function passwordMessage(e: AuthApiError): string {
  if (e.code === "weak_password") return "A senha deve ter pelo menos 8 caracteres.";
  if (e.code === "same_password") return "A nova senha deve ser diferente da atual.";
  if (e.status === 401 || e.code === "session_not_found" || e.code === "session_expired") {
    return "O link de recuperação expirou. Peça um novo link.";
  }
  if (e.status === 429 || e.code === "over_request_rate_limit") {
    return "Muitas tentativas. Aguarde um pouco e tente novamente.";
  }
  return GENERIC;
}

type ProviderProps = {
  children: ReactNode;
  /** Injeção para testes; em produção o cliente é criado no navegador, sob demanda. */
  client?: AuthClient;
  apiFetch?: typeof fetch;
  apiBaseUrl?: string;
  /** Cache de consultas: esvaziado ao sair, em 401 e quando o usuário da sessão muda. */
  queryClient?: QueryClient;
};

export function AuthProvider({
  children,
  client: injected,
  apiFetch,
  apiBaseUrl,
  queryClient,
}: ProviderProps) {
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;
  // Dados de um usuário nunca podem aparecer para o próximo (dados sigilosos).
  const clearCache = useCallback(() => {
    const qc = queryClientRef.current;
    if (!qc) return;
    void qc.cancelQueries();
    qc.clear();
  }, []);
  const lastUser = useRef<string | null>(null);
  // Chamado a cada sessão anunciada; só uma troca real de usuário esvazia o cache.
  const noteUser = useCallback(
    (session: { user?: { id: string } } | null) => {
      const id = session?.user?.id ?? null;
      if (id === null) return;
      if (lastUser.current !== null && lastUser.current !== id) clearCache();
      lastUser.current = id;
    },
    [clearCache],
  );
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [configError, setConfigError] = useState<string | null>(null);
  // Verdadeiro só entre o evento PASSWORD_RECOVERY e o fim da redefinição (ou a saída).
  const [recovery, setRecovery] = useState(false);
  const recoveryUser = useRef<string | null>(null);
  const clientRef = useRef<AuthClient | null>(injected ?? null);
  const redirected = useRef(false);
  const pathRef = useRef(pathname);
  // Nova rota: libera o redirecionamento. Feito na renderização para valer antes
  // dos efeitos dos filhos (ex.: AuthGuard remontado ao voltar no histórico).
  if (pathRef.current !== pathname) redirected.current = false;
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
    // Assina antes de pedir a sessão: o evento PASSWORD_RECOVERY é emitido durante a
    // inicialização do cliente e getSession só resolve depois dela.
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (active) {
        if (event === "PASSWORD_RECOVERY") {
          recoveryUser.current = session?.user?.id ?? null;
          setRecovery(true);
        } else if (event === "SIGNED_OUT") {
          setRecovery(false);
          lastUser.current = null;
          clearCache();
        } else if (event === "SIGNED_IN" && (session?.user?.id ?? null) !== recoveryUser.current) {
          // Outra conta entrou sem sair. O mesmo usuário reanunciado (volta à aba, outra aba)
          // não encerra a recuperação.
          setRecovery(false);
        }
      }
      if (active && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) noteUser(session);
      apply(session !== null);
    });
    void client.auth
      .getSession()
      .then(({ data }) => {
        if (active) noteUser(data.session);
        apply(data.session !== null);
      })
      .catch(() => apply(false));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [injected, clearCache, noteUser]);

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
    const onAuthPage = /^\/(entrar|cadastro|recuperar|nova-senha)(\/|$)/.test(path);
    routerRef.current.replace(
      onAuthPage ? "/entrar" : `/entrar?next=${encodeURIComponent(path + here)}`,
    );
  }, []);

  const signOut = useCallback(async () => {
    setStatus("signedOut");
    setRecovery(false);
    lastUser.current = null;
    clearCache();
    try {
      await clientRef.current?.auth.signOut({ scope: "local" });
    } catch {
      // sessão local já descartada na interface
    }
  }, [clearCache]);

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
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/nova-senha`,
      });
      if (error && (error.status === 429 || error.code === "over_request_rate_limit")) {
        return { error: "Muitas tentativas. Aguarde um pouco e tente novamente." };
      }
      // Resposta neutra: não revela se a conta existe.
      return { error: null };
    } catch {
      return { error: "Sem conexão. Verifique sua internet e tente novamente." };
    }
  }, []);

  const updatePassword = useCallback(async (password: string): Promise<AuthResult> => {
    const client = clientRef.current;
    if (!client) return { error: GENERIC };
    try {
      const { error } = await client.auth.updateUser({ password });
      if (!error) setRecovery(false);
      return { error: error ? passwordMessage(error) : null };
    } catch {
      return { error: "Sem conexão. Verifique sua internet e tente novamente." };
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      recovery,
      signIn,
      signUp,
      sendReset,
      updatePassword,
      signOut,
      getToken,
      redirectToLogin,
      api,
      configError,
    }),
    [status, recovery, signIn, signUp, sendReset, updatePassword, signOut, getToken, redirectToLogin, api, configError],
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
