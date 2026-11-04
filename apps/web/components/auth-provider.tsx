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
import { isOptedOut, markHandled, optOut, readInitData, wasHandled } from "@/lib/telegram-init";
import { signInWithTelegram, type TelegramLoginFailure } from "@/lib/telegram-login";

export type AuthStatus = "loading" | "signedIn" | "signedOut";

export type AuthResult = { error: string | null };
export type SignUpResult = AuthResult & { needsConfirmation: boolean };

/**
 * Entrada automática do Mini App pelo Telegram. `available`: há initData (o app abriu dentro do Telegram).
 * `signedOut`: a pessoa saiu da conta neste uso do app, então não entramos sozinhos de novo.
 */
export type TelegramLoginState = {
  available: boolean;
  phase: "idle" | "working" | "failed";
  error: TelegramLoginFailure | null;
  signedOut: boolean;
  /** Tenta entrar de novo com o mesmo initData (útil depois de falha de rede). */
  retry(): void;
};

export type AuthContextValue = {
  status: AuthStatus;
  telegram: TelegramLoginState;
  /** Sessão aberta pelo link de recuperação de senha (evento PASSWORD_RECOVERY). */
  recovery: boolean;
  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(email: string, password: string): Promise<SignUpResult>;
  sendReset(email: string): Promise<AuthResult>;
  /** Define a nova senha da sessão atual (a de recuperação, vinda do link do e-mail). */
  updatePassword(password: string): Promise<AuthResult>;
  /** Como a pessoa quer ser chamada (user_metadata.display_name); null se não definiu. */
  displayName: string | null;
  /** Id do usuário da sessão (chave dos dados locais); null sem sessão. */
  userId: string | null;
  /** Salva o nome (vazio remove). O nome vive só na conta de autenticação. */
  saveDisplayName(name: string): Promise<AuthResult>;
  /** Troca o token de uso único (login pelo Telegram ou por QR code) por uma sessão. */
  exchangeToken(tokenHash: string): Promise<AuthResult>;
  signOut(): Promise<void>;
  getToken(): Promise<string | null>;
  /** Redireciona para /entrar?next=<rota atual>, no máximo uma vez por sessão deslogada. */
  redirectToLogin(): void;
  api: ReturnType<typeof createApiClient>;
  /** Origem da API que `api` usa; as chamadas sem Bearer (login por QR) devem ir para a mesma. */
  apiBaseUrl: string;
  configError: string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const GENERIC = "Não foi possível concluir. Tente novamente.";

export const DISPLAY_NAME_MAX = 40;

function nameOf(session: { user?: { user_metadata?: { display_name?: unknown } } } | null): string | null {
  const v = session?.user?.user_metadata?.display_name;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

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
  /** Só para testes: `undefined` lê o initData do Telegram; `null` força "fora do Telegram". */
  initData?: string | null;
};

export function AuthProvider({
  children,
  client: injected,
  apiFetch,
  apiBaseUrl,
  queryClient,
  initData: initDataOverride,
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
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tgAvailable, setTgAvailable] = useState(false);
  const [tgPhase, setTgPhase] = useState<TelegramLoginState["phase"]>("idle");
  const [tgError, setTgError] = useState<TelegramLoginFailure | null>(null);
  const [tgSignedOut, setTgSignedOut] = useState(false);
  const initDataRef = useRef<string | null>(null);
  // Verdadeiro enquanto a entrada pelo Telegram está em curso: eventos "sem sessão" não podem mandar a
  // pessoa para o login antes de a troca terminar.
  const exchangingRef = useRef(false);
  const retryRef = useRef<() => void>(() => {});
  const apiBaseRef = useRef(apiBaseUrl);
  apiBaseRef.current = apiBaseUrl;
  const apiFetchRef = useRef(apiFetch);
  apiFetchRef.current = apiFetch;
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
    const initData = initDataOverride === undefined ? readInitData() : initDataOverride;
    initDataRef.current = initData;
    setTgAvailable(initData !== null);
    exchangingRef.current = initData !== null && !isOptedOut(initData) && !wasHandled(initData);
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
      if (active) {
        setDisplayName(nameOf(session));
        setUserId(session?.user?.id ?? null);
      }
      // Entrando pelo Telegram: um "sem sessão" agora é só o começo; quem decide é a troca.
      if (session === null && exchangingRef.current) return;
      apply(session !== null);
    });
    // Entrada pelo Telegram: com initData ainda não usado, troca-o por uma sessão da conta vinculada ANTES
    // de mostrar qualquer coisa (assim os dados de outra conta nunca aparecem). Com sessão já aberta, uma
    // falha não a derruba: só a ausência de sessão vira erro na tela.
    const attemptTelegram = async (initData: string, hadSession: boolean) => {
      exchangingRef.current = true;
      if (active) {
        setTgPhase("working");
        setTgError(null);
      }
      const result = await signInWithTelegram(client, {
        apiBaseUrl: apiBaseRef.current ?? readApiUrl(),
        initData,
        ...(apiFetchRef.current ? { fetch: apiFetchRef.current } : {}),
      });
      if (result.ok || result.code === "ja_utilizado") markHandled(initData);
      const { data: now } = await client.auth.getSession().catch(() => ({ data: { session: null } }));
      exchangingRef.current = false;
      if (!active) return;
      noteUser(now.session);
      setDisplayName(nameOf(now.session));
      setUserId(now.session?.user?.id ?? null);
      if (result.ok || hadSession) {
        setTgPhase("idle");
        setTgError(null);
      } else {
        setTgPhase("failed");
        setTgError(result.code);
      }
      apply(now.session !== null);
    };

    const boot = async () => {
      const { data } = await client.auth.getSession();
      if (!active) return;
      noteUser(data.session);
      setDisplayName(nameOf(data.session));
      setUserId(data.session?.user?.id ?? null);
      if (initData === null) return apply(data.session !== null);
      if (isOptedOut(initData)) {
        setTgSignedOut(true);
        return apply(data.session !== null);
      }
      if (wasHandled(initData)) return apply(data.session !== null);
      retryRef.current = () => {
        setStatus("loading");
        void attemptTelegram(initData, false);
      };
      await attemptTelegram(initData, data.session !== null);
    };
    void boot().catch(() => {
      exchangingRef.current = false;
      apply(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [injected, clearCache, noteUser, initDataOverride]);

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
    // Dentro do Telegram, sair não pode voltar a entrar sozinho com o mesmo initData (laço).
    if (initDataRef.current !== null) {
      optOut(initDataRef.current);
      setTgSignedOut(true);
    }
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

  const saveDisplayName = useCallback(async (name: string): Promise<AuthResult> => {
    const client = clientRef.current;
    if (!client) return { error: GENERIC };
    // eslint-disable-next-line no-control-regex
    const clean = name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, DISPLAY_NAME_MAX);
    try {
      const { error } = await client.auth.updateUser({ data: { display_name: clean === "" ? null : clean } });
      if (error) return { error: GENERIC };
      setDisplayName(clean === "" ? null : clean);
      return { error: null };
    } catch {
      return { error: "Sem conexão. Verifique sua internet e tente novamente." };
    }
  }, []);

  const exchangeToken = useCallback(async (tokenHash: string): Promise<AuthResult> => {
    const client = clientRef.current;
    if (!client) return { error: GENERIC };
    try {
      const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
      return { error: error ? GENERIC : null };
    } catch {
      return { error: "Sem conexão. Verifique sua internet e tente novamente." };
    }
  }, []);

  const telegram = useMemo<TelegramLoginState>(
    () => ({
      available: tgAvailable,
      phase: tgPhase,
      error: tgError,
      signedOut: tgSignedOut,
      retry: () => retryRef.current(),
    }),
    [tgAvailable, tgPhase, tgError, tgSignedOut],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      telegram,
      recovery,
      signIn,
      signUp,
      sendReset,
      updatePassword,
      displayName,
      userId,
      saveDisplayName,
      exchangeToken,
      signOut,
      getToken,
      redirectToLogin,
      api,
      apiBaseUrl: apiBaseUrl ?? readApiUrl(),
      configError,
    }),
    [status, telegram, recovery, signIn, signUp, sendReset, updatePassword, displayName, userId, saveDisplayName, exchangeToken, signOut, getToken, redirectToLogin, api, apiBaseUrl, configError],
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
