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

/** Estado da sessão: "loading" até a primeira resposta do Supabase (e da troca pelo Telegram). */
export type AuthStatus = "loading" | "signedIn" | "signedOut";

/** Resultado das ações de autenticação: `error` já vem como mensagem pronta para a pessoa. */
export type AuthResult = { error: string | null };

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

const GENERIC_ERROR_MESSAGE = "Não foi possível concluir. Tente novamente.";
const NETWORK_ERROR_MESSAGE = "Sem conexão. Verifique sua internet e tente novamente.";
const RATE_LIMIT_MESSAGE = "Muitas tentativas. Aguarde um pouco e tente novamente.";

const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY_REQUESTS = 429;

/** Rotas de acesso: redirecionar para o login a partir delas não guarda `next` (evita voltar para a própria tela). */
const AUTH_PAGE_PATTERN = /^\/(entrar|recuperar|nova-senha)(\/|$)/;

/** Caracteres de controle (C0 e DEL) removidos do nome antes de salvar. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/** Tamanho máximo do nome de exibição salvo na conta. */
export const DISPLAY_NAME_MAX = 40;

/** O pedaço da sessão do Supabase que o provedor lê: id e nome de exibição do usuário. */
type SessionUser = { user?: { id: string; user_metadata?: { display_name?: unknown } } } | null;

/** Lê o nome de exibição da sessão; vazio ou ausente vira null. */
function readDisplayName(session: SessionUser): string | null {
  const displayName = session?.user?.user_metadata?.display_name;
  return typeof displayName === "string" && displayName.trim() !== "" ? displayName.trim() : null;
}

function isRateLimited(error: AuthApiError): boolean {
  return error.status === HTTP_TOO_MANY_REQUESTS || error.code === "over_request_rate_limit";
}

function isInvalidCredentials(error: AuthApiError): boolean {
  return error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message ?? "");
}

/** Traduz o erro do login por senha numa mensagem para a pessoa. */
function describeLoginError(error: AuthApiError): string {
  if (isInvalidCredentials(error)) return "E-mail ou senha incorretos.";
  if (error.code === "email_not_confirmed") return "Confirme seu e-mail antes de entrar.";
  if (isRateLimited(error)) return RATE_LIMIT_MESSAGE;
  return GENERIC_ERROR_MESSAGE;
}

/** Traduz o erro da troca de senha (fluxo de recuperação) numa mensagem para a pessoa. */
function describePasswordError(error: AuthApiError): string {
  if (error.code === "weak_password") return "A senha deve ter pelo menos 8 caracteres.";
  if (error.code === "same_password") return "A nova senha deve ser diferente da atual.";
  const isRecoverySessionGone =
    error.status === HTTP_UNAUTHORIZED || error.code === "session_not_found" || error.code === "session_expired";
  if (isRecoverySessionGone) return "O link de recuperação expirou. Peça um novo link.";
  if (isRateLimited(error)) return RATE_LIMIT_MESSAGE;
  return GENERIC_ERROR_MESSAGE;
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

/**
 * Dono da sessão do painel e do Mini App. Ciclo de `status`:
 * - "loading": até a primeira resposta do Supabase (e, dentro do Telegram, até a troca do initData terminar);
 * - "signedIn" / "signedOut": decididos pelos eventos de `onAuthStateChange` e pela sessão lida no boot.
 * Em paralelo, `recovery` marca a sessão aberta pelo link de redefinição de senha, e `telegram` expõe o
 * andamento da entrada automática pelo Telegram. Toda troca de usuário esvazia o cache de consultas.
 */
export function AuthProvider({
  children,
  client: injectedClient,
  apiFetch,
  apiBaseUrl,
  queryClient,
  initData: initDataOverride,
}: ProviderProps) {
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;
  // Dados de um usuário nunca podem aparecer para o próximo (dados sigilosos).
  const clearCache = useCallback(() => {
    const currentQueryClient = queryClientRef.current;
    if (!currentQueryClient) return;
    void currentQueryClient.cancelQueries();
    currentQueryClient.clear();
  }, []);
  const lastUserIdRef = useRef<string | null>(null);
  // Chamado a cada sessão anunciada; só uma troca real de usuário esvazia o cache.
  const trackSessionUser = useCallback(
    (session: { user?: { id: string } } | null) => {
      const sessionUserId = session?.user?.id ?? null;
      if (sessionUserId === null) return;
      const isDifferentUser = lastUserIdRef.current !== null && lastUserIdRef.current !== sessionUserId;
      if (isDifferentUser) clearCache();
      lastUserIdRef.current = sessionUserId;
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
  const [telegramAvailable, setTelegramAvailable] = useState(false);
  const [telegramPhase, setTelegramPhase] = useState<TelegramLoginState["phase"]>("idle");
  const [telegramError, setTelegramError] = useState<TelegramLoginFailure | null>(null);
  const [telegramSignedOut, setTelegramSignedOut] = useState(false);
  const initDataRef = useRef<string | null>(null);
  // Verdadeiro enquanto a entrada pelo Telegram está em curso: eventos "sem sessão" não podem mandar a
  // pessoa para o login antes de a troca terminar.
  const exchangingTelegramRef = useRef(false);
  const retryTelegramRef = useRef<() => void>(() => {});
  const apiBaseUrlRef = useRef(apiBaseUrl);
  apiBaseUrlRef.current = apiBaseUrl;
  const apiFetchRef = useRef(apiFetch);
  apiFetchRef.current = apiFetch;
  // Usuário da sessão de recuperação: o mesmo usuário reanunciado não encerra a recuperação.
  const recoveryUserIdRef = useRef<string | null>(null);
  const clientRef = useRef<AuthClient | null>(injectedClient ?? null);
  // Garante no máximo um redirecionamento ao login por rota enquanto deslogado.
  const redirectedToLoginRef = useRef(false);
  const pathnameRef = useRef(pathname);
  // Nova rota: libera o redirecionamento. Feito na renderização para valer antes
  // dos efeitos dos filhos (ex.: AuthGuard remontado ao voltar no histórico).
  if (pathnameRef.current !== pathname) redirectedToLoginRef.current = false;
  pathnameRef.current = pathname;
  const routerRef = useRef(router);
  routerRef.current = router;

  // Boot da sessão: cria o cliente, assina os eventos de autenticação, lê a sessão atual e, dentro do
  // Telegram, tenta a entrada automática. Roda de novo só se o cliente injetado ou o initData mudarem.
  useEffect(() => {
    let client = injectedClient ?? clientRef.current;
    if (!client) {
      try {
        client = createSupabase();
      } catch (error) {
        // Variáveis de ambiente ausentes: o AuthGuard mostra o erro em vez de mandar para o login.
        setConfigError(error instanceof Error ? error.message : String(error));
        setStatus("signedOut");
        return;
      }
    }
    clientRef.current = client;
    let active = true;
    const initData = initDataOverride === undefined ? readInitData() : initDataOverride;
    initDataRef.current = initData;
    setTelegramAvailable(initData !== null);
    exchangingTelegramRef.current = initData !== null && !isOptedOut(initData) && !wasHandled(initData);
    const applySessionStatus = (hasSession: boolean) => {
      if (!active) return;
      if (hasSession) redirectedToLoginRef.current = false;
      setStatus(hasSession ? "signedIn" : "signedOut");
    };
    const applySessionUser = (session: SessionUser) => {
      setDisplayName(readDisplayName(session));
      setUserId(session?.user?.id ?? null);
    };
    // Assina antes de pedir a sessão: o evento PASSWORD_RECOVERY é emitido durante a
    // inicialização do cliente e getSession só resolve depois dela.
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (active) {
        if (event === "PASSWORD_RECOVERY") {
          recoveryUserIdRef.current = session?.user?.id ?? null;
          setRecovery(true);
        } else if (event === "SIGNED_OUT") {
          setRecovery(false);
          lastUserIdRef.current = null;
          clearCache();
        } else if (event === "SIGNED_IN" && (session?.user?.id ?? null) !== recoveryUserIdRef.current) {
          // Outra conta entrou sem sair. O mesmo usuário reanunciado (volta à aba, outra aba)
          // não encerra a recuperação.
          setRecovery(false);
        }
      }
      if (active && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) trackSessionUser(session);
      if (active) applySessionUser(session);
      // Entrando pelo Telegram: um "sem sessão" agora é só o começo; quem decide é a troca.
      if (session === null && exchangingTelegramRef.current) return;
      applySessionStatus(session !== null);
    });
    // Entrada pelo Telegram: com initData ainda não usado, troca-o por uma sessão da conta vinculada ANTES
    // de mostrar qualquer coisa (assim os dados de outra conta nunca aparecem). Com sessão já aberta, uma
    // falha não a derruba: só a ausência de sessão vira erro na tela.
    const attemptTelegramLogin = async (telegramInitData: string, hadSession: boolean) => {
      exchangingTelegramRef.current = true;
      if (active) {
        setTelegramPhase("working");
        setTelegramError(null);
      }
      const result = await signInWithTelegram(client, {
        apiBaseUrl: apiBaseUrlRef.current ?? readApiUrl(),
        initData: telegramInitData,
        ...(apiFetchRef.current ? { fetch: apiFetchRef.current } : {}),
      });
      // initData já consumido (com sucesso ou não) não deve ser tentado de novo ao recarregar.
      if (result.ok || result.code === "ja_utilizado") markHandled(telegramInitData);
      const { data: current } = await client.auth.getSession().catch(() => ({ data: { session: null } }));
      exchangingTelegramRef.current = false;
      if (!active) return;
      trackSessionUser(current.session);
      applySessionUser(current.session);
      if (result.ok || hadSession) {
        setTelegramPhase("idle");
        setTelegramError(null);
      } else {
        setTelegramPhase("failed");
        setTelegramError(result.code);
      }
      applySessionStatus(current.session !== null);
    };

    const boot = async () => {
      const { data: initial } = await client.auth.getSession();
      if (!active) return;
      trackSessionUser(initial.session);
      applySessionUser(initial.session);
      const hasSession = initial.session !== null;
      if (initData === null) return applySessionStatus(hasSession);
      // A pessoa saiu da conta neste initData: não entra sozinha de novo.
      if (isOptedOut(initData)) {
        setTelegramSignedOut(true);
        return applySessionStatus(hasSession);
      }
      if (wasHandled(initData)) return applySessionStatus(hasSession);
      retryTelegramRef.current = () => {
        setStatus("loading");
        void attemptTelegramLogin(initData, false);
      };
      await attemptTelegramLogin(initData, hasSession);
    };
    void boot().catch(() => {
      exchangingTelegramRef.current = false;
      applySessionStatus(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [injectedClient, clearCache, trackSessionUser, initDataOverride]);

  const getToken = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const redirectToLogin = useCallback(() => {
    if (redirectedToLoginRef.current) return;
    redirectedToLoginRef.current = true;
    const path = pathnameRef.current ?? "/";
    const search = typeof window === "undefined" ? "" : window.location.search;
    const onAuthPage = AUTH_PAGE_PATTERN.test(path);
    routerRef.current.replace(
      onAuthPage ? "/entrar" : `/entrar?next=${encodeURIComponent(path + search)}`,
    );
  }, []);

  const signOut = useCallback(async () => {
    // Dentro do Telegram, sair não pode voltar a entrar sozinho com o mesmo initData (laço).
    if (initDataRef.current !== null) {
      optOut(initDataRef.current);
      setTelegramSignedOut(true);
    }
    // A interface sai na hora; a chamada ao Supabase vem depois e pode falhar sem efeito visível.
    setStatus("signedOut");
    setRecovery(false);
    lastUserIdRef.current = null;
    clearCache();
    try {
      await clientRef.current?.auth.signOut({ scope: "local" });
    } catch {
      // sessão local já descartada na interface
    }
  }, [clearCache]);

  // 401 da API: a sessão não vale mais; sai e manda para o login.
  const handleUnauthorized = useCallback(() => {
    void signOut();
    redirectToLogin();
  }, [signOut, redirectToLogin]);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: apiBaseUrl ?? readApiUrl(),
        getToken,
        onUnauthorized: handleUnauthorized,
        ...(apiFetch ? { fetch: apiFetch } : {}),
      }),
    [apiBaseUrl, apiFetch, getToken, handleUnauthorized],
  );

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const client = clientRef.current;
    if (!client) return { error: GENERIC_ERROR_MESSAGE };
    try {
      const { error } = await client.auth.signInWithPassword({ email, password });
      return { error: error ? describeLoginError(error) : null };
    } catch {
      return { error: NETWORK_ERROR_MESSAGE };
    }
  }, []);

  const sendReset = useCallback(async (email: string): Promise<AuthResult> => {
    const client = clientRef.current;
    if (!client) return { error: GENERIC_ERROR_MESSAGE };
    try {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/nova-senha`,
      });
      if (error && isRateLimited(error)) return { error: RATE_LIMIT_MESSAGE };
      // Resposta neutra: não revela se a conta existe.
      return { error: null };
    } catch {
      return { error: NETWORK_ERROR_MESSAGE };
    }
  }, []);

  const updatePassword = useCallback(async (password: string): Promise<AuthResult> => {
    const client = clientRef.current;
    if (!client) return { error: GENERIC_ERROR_MESSAGE };
    try {
      const { error } = await client.auth.updateUser({ password });
      if (!error) setRecovery(false);
      return { error: error ? describePasswordError(error) : null };
    } catch {
      return { error: NETWORK_ERROR_MESSAGE };
    }
  }, []);

  const saveDisplayName = useCallback(async (name: string): Promise<AuthResult> => {
    const client = clientRef.current;
    if (!client) return { error: GENERIC_ERROR_MESSAGE };
    const cleanName = name.replace(CONTROL_CHARACTERS, "").trim().slice(0, DISPLAY_NAME_MAX);
    const nameToSave = cleanName === "" ? null : cleanName;
    try {
      const { error } = await client.auth.updateUser({ data: { display_name: nameToSave } });
      if (error) return { error: GENERIC_ERROR_MESSAGE };
      setDisplayName(nameToSave);
      return { error: null };
    } catch {
      return { error: NETWORK_ERROR_MESSAGE };
    }
  }, []);

  const exchangeToken = useCallback(async (tokenHash: string): Promise<AuthResult> => {
    const client = clientRef.current;
    if (!client) return { error: GENERIC_ERROR_MESSAGE };
    try {
      const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
      return { error: error ? GENERIC_ERROR_MESSAGE : null };
    } catch {
      return { error: NETWORK_ERROR_MESSAGE };
    }
  }, []);

  const telegram = useMemo<TelegramLoginState>(
    () => ({
      available: telegramAvailable,
      phase: telegramPhase,
      error: telegramError,
      signedOut: telegramSignedOut,
      retry: () => retryTelegramRef.current(),
    }),
    [telegramAvailable, telegramPhase, telegramError, telegramSignedOut],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      telegram,
      recovery,
      signIn,
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
    [status, telegram, recovery, signIn, sendReset, updatePassword, displayName, userId, saveDisplayName, exchangeToken, signOut, getToken, redirectToLogin, api, apiBaseUrl, configError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Acesso ao estado de autenticação; falha cedo se usado fora do provedor. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return context;
}

/** Cliente da API já ligado ao token e ao tratamento de 401. */
export function useApi() {
  return useAuth().api;
}
