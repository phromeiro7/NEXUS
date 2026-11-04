import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { signInWithTelegram } from "./telegram-login";

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const call = (f: ReturnType<typeof fakeSupabase>, fetchFn: typeof fetch, initData = "d=1&hash=h") =>
  signInWithTelegram(f.client, { apiBaseUrl: "http://api.test", initData, fetch: fetchFn });

describe("signInWithTelegram", () => {
  it("pede o token à API, sem Bearer, e o troca por sessão", async () => {
    const f = fakeSupabase();
    const fetchFn = reply(200, { tokenHash: "tok" });
    expect(await call(f, fetchFn as never)).toEqual({ ok: true });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/auth/telegram");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ initData: "d=1&hash=h" });
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization/i);
    expect(f.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "tok", type: "magiclink" });
  });

  it.each([
    ["telegram_nao_vinculado", 403],
    ["ja_utilizado", 401],
    ["sessao_expirada", 401],
    ["assinatura_invalida", 401],
    ["muitas_tentativas", 429],
    ["login_desabilitado", 503],
  ] as const)("devolve o código %s da API sem tocar no Supabase", async (code, status) => {
    const f = fakeSupabase();
    expect(await call(f, reply(status, { error: code }) as never)).toEqual({ ok: false, code });
    expect(f.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("erro desconhecido ou corpo ilegível vira genérico; sem rede vira rede", async () => {
    const f = fakeSupabase();
    expect(await call(f, reply(500, { error: "erro_interno" }) as never)).toEqual({ ok: false, code: "generico" });
    expect(await call(f, vi.fn(async () => new Response("<html>", { status: 502 })) as never)).toEqual({ ok: false, code: "generico" });
    expect(await call(f, reply(200, { semToken: true }) as never)).toEqual({ ok: false, code: "generico" });
    expect(await call(f, vi.fn(async () => Promise.reject(new TypeError("offline"))) as never)).toEqual({ ok: false, code: "rede" });
  });

  it("falha do verifyOtp vira erro, sem expor a mensagem", async () => {
    const f = fakeSupabase();
    f.auth.verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: { message: "Token has expired" } });
    expect(await call(f, reply(200, { tokenHash: "tok" }) as never)).toEqual({ ok: false, code: "generico" });
  });

  it("dois disparos simultâneos do mesmo initData fazem uma só chamada", async () => {
    const f = fakeSupabase();
    const fetchFn = reply(200, { tokenHash: "tok" });
    const [a, b] = await Promise.all([call(f, fetchFn as never), call(f, fetchFn as never)]);
    expect([a, b]).toEqual([{ ok: true }, { ok: true }]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    // Depois de terminar, um novo pedido faz nova chamada.
    await call(f, fetchFn as never);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
