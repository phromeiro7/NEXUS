import { QR_LOGIN_POLL_HEADER, qrLoginCreateResultSchema, qrLoginStatusSchema, type QrLoginStatus } from "@nexus/shared";
import { HTTP_NOT_FOUND, HTTP_TOO_MANY_REQUESTS } from "./http";

/** Falhas que a tela sabe explicar. Nunca carregam o segredo nem o token. */
export type QrLoginFailure = "rede" | "muitas_tentativas" | "login_desabilitado" | "ja_utilizado" | "nao_encontrado" | "generico";

export type QrLoginRequest = { id: string; pollSecret: string; deepLink: string };

/** Resultado de criar o pedido de login: o pedido ou o motivo da falha. */
export type QrLoginCreateResult = { ok: true; request: QrLoginRequest } | { ok: false; code: QrLoginFailure; retryAfterSeconds?: number };
/** Resultado de uma consulta ao pedido: o estado atual ou o motivo da falha. */
export type QrLoginPollResult =
  | { ok: true; status: QrLoginStatus; tokenHash?: string }
  | { ok: false; code: QrLoginFailure; retryAfterSeconds?: number };

type QrLoginRequestOptions = { apiBaseUrl: string; fetch?: typeof fetch; signal?: AbortSignal };

/** Traduz uma resposta de erro (status + corpo) para um motivo que a tela sabe explicar. */
function failureFrom(response: Response, body: unknown): { code: QrLoginFailure; retryAfterSeconds?: number } {
  const isObjectBody = typeof body === "object" && body !== null;
  const errorCode = isObjectBody ? (body as { error?: unknown }).error : undefined;
  if (response.status === HTTP_TOO_MANY_REQUESTS || errorCode === "muitas_tentativas") {
    const retryAfterSeconds = isObjectBody ? (body as { retryAfterSeconds?: unknown }).retryAfterSeconds : undefined;
    return { code: "muitas_tentativas", ...(typeof retryAfterSeconds === "number" ? { retryAfterSeconds } : {}) };
  }
  if (errorCode === "login_desabilitado") return { code: "login_desabilitado" };
  if (errorCode === "ja_utilizado") return { code: "ja_utilizado" };
  if (response.status === HTTP_NOT_FOUND) return { code: "nao_encontrado" };
  return { code: "generico" };
}

/** Pede um novo pedido de login. Sem Bearer: ainda não há conta. O `pollSecret` volta só aqui. */
export async function createQrLogin(options: QrLoginRequestOptions): Promise<QrLoginCreateResult> {
  const doFetch = options.fetch ?? fetch;
  try {
    const response = await doFetch(`${options.apiBaseUrl}/auth/qr`, {
      method: "POST",
      cache: "no-store",
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, ...failureFrom(response, body) };
    const parsed = qrLoginCreateResultSchema.safeParse(body);
    if (!parsed.success) return { ok: false, code: "generico" };
    const { id, pollSecret, deepLink } = parsed.data;
    return { ok: true, request: { id, pollSecret, deepLink } };
  } catch {
    return { ok: false, code: "rede" };
  }
}

/** Consulta o pedido. O segredo vai no cabeçalho, nunca na URL (a URL aparece em registros). */
export async function pollQrLogin(options: QrLoginRequestOptions & { id: string; pollSecret: string }): Promise<QrLoginPollResult> {
  const doFetch = options.fetch ?? fetch;
  try {
    const response = await doFetch(`${options.apiBaseUrl}/auth/qr/${encodeURIComponent(options.id)}`, {
      cache: "no-store",
      headers: { [QR_LOGIN_POLL_HEADER]: options.pollSecret },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, ...failureFrom(response, body) };
    const parsed = qrLoginStatusSchema.safeParse(body);
    if (!parsed.success) return { ok: false, code: "generico" };
    return { ok: true, status: parsed.data.status, ...(parsed.data.tokenHash !== undefined ? { tokenHash: parsed.data.tokenHash } : {}) };
  } catch {
    return { ok: false, code: "rede" };
  }
}
