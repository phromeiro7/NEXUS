import { describe, expect, it, vi } from "vitest";
import { createQrLogin, pollQrLogin } from "./qr-login";

const ID = "3f1c1b8e-6a63-4b0a-9a35-0d3b3f6a4a11";
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const created = { id: ID, pollSecret: "p".repeat(43), deepLink: "https://t.me/nexus_bot?start=login_abc", expiresAt: "2026-11-04T12:03:00.000Z" };

describe("createQrLogin", () => {
  it("pede o pedido sem Bearer e devolve só o que a tela usa", async () => {
    const fetchFn = reply(201, created);
    const result = await createQrLogin({ apiBaseUrl: "http://api.test", fetch: fetchFn as never });
    expect(result).toEqual({ ok: true, request: { id: ID, pollSecret: created.pollSecret, deepLink: created.deepLink } });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/auth/qr");
    expect(init.method).toBe("POST");
    expect(JSON.stringify(init.headers ?? {})).not.toMatch(/authorization/i);
  });

  it.each([
    [503, { error: "login_desabilitado" }, "login_desabilitado"],
    [429, { error: "muitas_tentativas", retryAfterSeconds: 30 }, "muitas_tentativas"],
    [500, { error: "erro_interno" }, "generico"],
  ] as const)("mapeia %i para %s", async (status, body, code) => {
    const result = await createQrLogin({ apiBaseUrl: "http://api.test", fetch: reply(status, body) as never });
    expect(result).toMatchObject({ ok: false, code });
  });

  it("resposta fora do formato combinado é erro genérico; sem rede é rede", async () => {
    expect(await createQrLogin({ apiBaseUrl: "http://a", fetch: reply(201, { id: "x" }) as never })).toEqual({ ok: false, code: "generico" });
    expect(await createQrLogin({ apiBaseUrl: "http://a", fetch: vi.fn(async () => Promise.reject(new TypeError("offline"))) as never })).toEqual({ ok: false, code: "rede" });
  });
});

describe("pollQrLogin", () => {
  it("manda o segredo no cabeçalho e nunca na URL", async () => {
    const fetchFn = reply(200, { status: "aguardando", expiresAt: created.expiresAt });
    const result = await pollQrLogin({ apiBaseUrl: "http://api.test", id: ID, pollSecret: "segredo-segredo-segredo", fetch: fetchFn as never });
    expect(result).toEqual({ ok: true, status: "aguardando" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://api.test/auth/qr/${ID}`);
    expect(url).not.toContain("segredo");
    expect((init.headers as Record<string, string>)["X-Poll-Secret"]).toBe("segredo-segredo-segredo");
  });

  it("devolve o token só quando aprovado", async () => {
    const result = await pollQrLogin({ apiBaseUrl: "http://a", id: ID, pollSecret: "s".repeat(20), fetch: reply(200, { status: "aprovado", expiresAt: "x", tokenHash: "tok" }) as never });
    expect(result).toEqual({ ok: true, status: "aprovado", tokenHash: "tok" });
  });

  it.each([
    [404, { error: "nao_encontrado" }, "nao_encontrado"],
    [401, { error: "ja_utilizado" }, "ja_utilizado"],
    [429, { error: "muitas_tentativas", retryAfterSeconds: 7 }, "muitas_tentativas"],
  ] as const)("mapeia %i para %s", async (status, body, code) => {
    const result = await pollQrLogin({ apiBaseUrl: "http://a", id: ID, pollSecret: "s".repeat(20), fetch: reply(status, body) as never });
    expect(result).toMatchObject({ ok: false, code });
  });

  it("estado desconhecido é erro genérico", async () => {
    const result = await pollQrLogin({ apiBaseUrl: "http://a", id: ID, pollSecret: "s".repeat(20), fetch: reply(200, { status: "consumido", expiresAt: "x" }) as never });
    expect(result).toEqual({ ok: false, code: "generico" });
  });
});
