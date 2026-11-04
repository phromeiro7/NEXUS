import type { AuthClient } from "./supabase";

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

const KNOWN: readonly string[] = [
  "assinatura_invalida",
  "sessao_expirada",
  "ja_utilizado",
  "telegram_nao_vinculado",
  "muitas_tentativas",
  "login_desabilitado",
];

function codeOf(body: unknown): TelegramLoginFailure {
  const e = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
  return typeof e === "string" && KNOWN.includes(e) ? (e as TelegramLoginFailure) : "generico";
}

// Dois disparos do mesmo initData ao mesmo tempo (ex.: efeito duplicado em desenvolvimento) dividem uma
// só chamada: a API só aceita cada assinatura uma vez.
const inflight = new Map<string, Promise<TelegramLoginResult>>();

/**
 * Troca o `initData` assinado por uma sessão da conta que o Telegram tem vinculada: pede à API um token de
 * uso único e o entrega ao Supabase (`verifyOtp`). Sem Bearer: a prova de identidade é a assinatura.
 * Nada é registrado; o resultado só tem um código, nunca o initData nem o token.
 */
export function signInWithTelegram(
  client: AuthClient,
  opts: { apiBaseUrl: string; initData: string; fetch?: typeof fetch },
): Promise<TelegramLoginResult> {
  const existing = inflight.get(opts.initData);
  if (existing) return existing;
  const run = (async (): Promise<TelegramLoginResult> => {
    const doFetch = opts.fetch ?? fetch;
    let tokenHash: string;
    try {
      const res = await doFetch(`${opts.apiBaseUrl}/auth/telegram`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initData: opts.initData }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, code: codeOf(body) };
      const hash = typeof body === "object" && body !== null ? (body as { tokenHash?: unknown }).tokenHash : undefined;
      if (typeof hash !== "string" || hash === "") return { ok: false, code: "generico" };
      tokenHash = hash;
    } catch {
      return { ok: false, code: "rede" };
    }
    try {
      const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
      return error ? { ok: false, code: "generico" } : { ok: true };
    } catch {
      return { ok: false, code: "rede" };
    }
  })().finally(() => inflight.delete(opts.initData));
  inflight.set(opts.initData, run);
  return run;
}
