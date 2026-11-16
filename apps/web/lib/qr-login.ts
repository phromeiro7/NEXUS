import { QR_LOGIN_POLL_HEADER, qrLoginCreateResultSchema, qrLoginStatusSchema, type QrLoginStatus } from "@nexus/shared";

/** Falhas que a tela sabe explicar. Nunca carregam o segredo nem o token. */
export type QrLoginFailure = "rede" | "muitas_tentativas" | "login_desabilitado" | "ja_utilizado" | "nao_encontrado" | "generico";

export type QrLoginRequest = { id: string; pollSecret: string; deepLink: string };

export type CreateResult = { ok: true; request: QrLoginRequest } | { ok: false; code: QrLoginFailure; retryAfterSeconds?: number };
export type PollResult =
  | { ok: true; status: QrLoginStatus; tokenHash?: string }
  | { ok: false; code: QrLoginFailure; retryAfterSeconds?: number };

type Opts = { apiBaseUrl: string; fetch?: typeof fetch; signal?: AbortSignal };

function failure(res: Response, body: unknown): { code: QrLoginFailure; retryAfterSeconds?: number } {
  const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
  if (res.status === 429 || error === "muitas_tentativas") {
    const wait = typeof body === "object" && body !== null ? (body as { retryAfterSeconds?: unknown }).retryAfterSeconds : undefined;
    return { code: "muitas_tentativas", ...(typeof wait === "number" ? { retryAfterSeconds: wait } : {}) };
  }
  if (error === "login_desabilitado") return { code: "login_desabilitado" };
  if (error === "ja_utilizado") return { code: "ja_utilizado" };
  if (res.status === 404) return { code: "nao_encontrado" };
  return { code: "generico" };
}

/** Pede um novo pedido de login. Sem Bearer: ainda não há conta. O `pollSecret` volta só aqui. */
export async function createQrLogin(opts: Opts): Promise<CreateResult> {
  const doFetch = opts.fetch ?? fetch;
  try {
    const res = await doFetch(`${opts.apiBaseUrl}/auth/qr`, { method: "POST", cache: "no-store", ...(opts.signal ? { signal: opts.signal } : {}) });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, ...failure(res, body) };
    const parsed = qrLoginCreateResultSchema.safeParse(body);
    if (!parsed.success) return { ok: false, code: "generico" };
    const { id, pollSecret, deepLink } = parsed.data;
    return { ok: true, request: { id, pollSecret, deepLink } };
  } catch {
    return { ok: false, code: "rede" };
  }
}

/** Consulta o pedido. O segredo vai no cabeçalho, nunca na URL (a URL aparece em registros). */
export async function pollQrLogin(opts: Opts & { id: string; pollSecret: string }): Promise<PollResult> {
  const doFetch = opts.fetch ?? fetch;
  try {
    const res = await doFetch(`${opts.apiBaseUrl}/auth/qr/${encodeURIComponent(opts.id)}`, {
      cache: "no-store",
      headers: { [QR_LOGIN_POLL_HEADER]: opts.pollSecret },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, ...failure(res, body) };
    const parsed = qrLoginStatusSchema.safeParse(body);
    if (!parsed.success) return { ok: false, code: "generico" };
    return { ok: true, status: parsed.data.status, ...(parsed.data.tokenHash !== undefined ? { tokenHash: parsed.data.tokenHash } : {}) };
  } catch {
    return { ok: false, code: "rede" };
  }
}
