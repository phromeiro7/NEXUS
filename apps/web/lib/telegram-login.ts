import type { AuthClient } from "./supabase";

/** Falhas do login pelo Telegram que a tela sabe explicar (os códigos vêm da API, mais "rede" e "generico"). */
export type TelegramLoginFailure =
  | "assinatura_invalida"
  | "sessao_expirada"
  | "ja_utilizado"
  | "telegram_nao_vinculado"
  | "muitas_tentativas"
  | "login_desabilitado"
  | "rede"
  | "generico";

export type TelegramLoginResult = { ok: true } | { ok: false; code: TelegramLoginFailure };

/** Códigos da API repassados como estão; qualquer outro vira "generico". */
const KNOWN_FAILURE_CODES: readonly string[] = [
  "assinatura_invalida",
  "sessao_expirada",
  "ja_utilizado",
  "telegram_nao_vinculado",
  "muitas_tentativas",
  "login_desabilitado",
];

function failureCodeOf(body: unknown): TelegramLoginFailure {
  const errorCode = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
  return typeof errorCode === "string" && KNOWN_FAILURE_CODES.includes(errorCode)
    ? (errorCode as TelegramLoginFailure)
    : "generico";
}

// Dois disparos do mesmo initData ao mesmo tempo (ex.: efeito duplicado em desenvolvimento) dividem uma
// só chamada: a API só aceita cada assinatura uma vez.
const inFlightByInitData = new Map<string, Promise<TelegramLoginResult>>();

/**
 * Troca o `initData` assinado por uma sessão da conta que o Telegram tem vinculada: pede à API um token de
 * uso único e o entrega ao Supabase (`verifyOtp`). Sem Bearer: a prova de identidade é a assinatura.
 * Nada é registrado; o resultado só tem um código, nunca o initData nem o token.
 */
export function signInWithTelegram(
  client: AuthClient,
  options: { apiBaseUrl: string; initData: string; fetch?: typeof fetch },
): Promise<TelegramLoginResult> {
  const existing = inFlightByInitData.get(options.initData);
  if (existing) return existing;
  const signIn = (async (): Promise<TelegramLoginResult> => {
    const doFetch = options.fetch ?? fetch;
    let tokenHash: string;
    try {
      const response = await doFetch(`${options.apiBaseUrl}/auth/telegram`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initData: options.initData }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) return { ok: false, code: failureCodeOf(body) };
      const receivedHash = typeof body === "object" && body !== null ? (body as { tokenHash?: unknown }).tokenHash : undefined;
      if (typeof receivedHash !== "string" || receivedHash === "") return { ok: false, code: "generico" };
      tokenHash = receivedHash;
    } catch {
      return { ok: false, code: "rede" };
    }
    try {
      const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
      return error ? { ok: false, code: "generico" } : { ok: true };
    } catch {
      return { ok: false, code: "rede" };
    }
  })().finally(() => inFlightByInitData.delete(options.initData));
  inFlightByInitData.set(options.initData, signIn);
  return signIn;
}
