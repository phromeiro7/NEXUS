import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQrLogin } from "./use-qr-login";

const ID = "3f1c1b8e-6a63-4b0a-9a35-0d3b3f6a4a11";
const SECRET = "p".repeat(43);
const created = { id: ID, pollSecret: SECRET, deepLink: "https://t.me/nexus_bot?start=login_abc", expiresAt: "2026-11-04T12:03:00.000Z" };
const status = (s: string, extra: object = {}) => ({ status: s, expiresAt: created.expiresAt, ...extra });

type Step = { status?: number; body?: unknown; fail?: boolean };

/** fetch de mentira: POST /auth/qr devolve o pedido; cada GET consome o próximo passo do roteiro. */
function script(steps: Step[]) {
  const polls: Array<{ url: string; secret: string | undefined }> = [];
  let createdCount = 0;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      createdCount += 1;
      return new Response(JSON.stringify(created), { status: 201 });
    }
    polls.push({ url, secret: (init?.headers as Record<string, string> | undefined)?.["X-Poll-Secret"] });
    const step = steps.shift() ?? { body: status("aguardando") };
    if (step.fail) throw new TypeError("offline");
    return new Response(JSON.stringify(step.body), { status: step.status ?? 200 });
  });
  return { fn: fn as unknown as typeof fetch, polls, created: () => createdCount };
}

const setup = (steps: Step[], over: { enabled?: boolean; exchange?: (t: string) => Promise<{ error: string | null }> } = {}) => {
  const s = script(steps);
  const exchangeToken = vi.fn(over.exchange ?? (async () => ({ error: null })));
  const onSignedIn = vi.fn();
  const hook = renderHook(() =>
    useQrLogin({ enabled: over.enabled ?? true, apiBaseUrl: "http://api.test", exchangeToken, onSignedIn, fetch: s.fn }),
  );
  return { ...s, hook, exchangeToken, onSignedIn };
};
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const settle = () => advance(0);

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
});

describe("useQrLogin", () => {
  it("cria o pedido e fica aguardando com o link do bot", async () => {
    const t = setup([]);
    expect(t.hook.result.current.phase).toBe("creating");
    await settle();
    expect(t.hook.result.current).toMatchObject({ phase: "waiting", deepLink: created.deepLink, error: null });
    expect(t.created()).toBe(1);
  });

  it("não cria pedido nenhum quando desligado (dentro do Telegram)", async () => {
    const t = setup([], { enabled: false });
    await advance(10_000);
    expect(t.fn).not.toHaveBeenCalled();
  });

  it("consulta a cada ~2 s com o segredo no cabeçalho, passa por 'confirme no celular' e entra", async () => {
    const t = setup([{ body: status("aguardando") }, { body: status("confirmar") }, { body: status("aprovado", { tokenHash: "tok-1" }) }]);
    await settle();
    await advance(2_000);
    expect(t.hook.result.current.phase).toBe("waiting");
    await advance(2_000);
    expect(t.hook.result.current.phase).toBe("confirm");
    await advance(2_000);
    expect(t.exchangeToken).toHaveBeenCalledExactlyOnceWith("tok-1");
    expect(t.onSignedIn).toHaveBeenCalledTimes(1);
    expect(t.polls).toHaveLength(3);
    expect(t.polls.every((p) => p.secret === SECRET && !p.url.includes(SECRET))).toBe(true);
    await advance(30_000);
    expect(t.polls).toHaveLength(3); // terminou: nada mais é consultado
  });

  it("a espera cresce: 2 s no começo, 3 s depois de 30 s, 5 s depois de 90 s", async () => {
    const t = setup([]);
    await settle();
    await advance(2_000); // 1ª consulta em t=2s
    await advance(28_000); // até t=30s: consultas a cada 2 s
    const early = t.polls.length;
    expect(early).toBeGreaterThanOrEqual(14);
    await advance(30_000); // t=60s: agora a cada 3 s
    const mid = t.polls.length - early;
    expect(mid).toBeGreaterThanOrEqual(9);
    expect(mid).toBeLessThanOrEqual(11);
    await advance(30_000); // até t=90s ainda a cada 3 s
    const before = t.polls.length;
    await advance(60_000); // de t=90s a t=150s: a cada 5 s
    const late = t.polls.length - before;
    expect(late).toBeGreaterThanOrEqual(11);
    expect(late).toBeLessThanOrEqual(13);
  });

  it.each([
    ["negado", "denied"],
    ["recusado", "refused"],
    ["expirado", "expired"],
  ] as const)("estado %s encerra a consulta em %s", async (serverStatus, phase) => {
    const t = setup([{ body: status(serverStatus) }]);
    await settle();
    await advance(2_000);
    expect(t.hook.result.current.phase).toBe(phase);
    await advance(20_000);
    expect(t.polls).toHaveLength(1);
    expect(t.exchangeToken).not.toHaveBeenCalled();
  });

  it("pedido que o servidor já não conhece conta como expirado", async () => {
    const t = setup([{ status: 404, body: { error: "nao_encontrado" } }]);
    await settle();
    await advance(2_000);
    expect(t.hook.result.current.phase).toBe("expired");
  });

  it("não consulta com a aba escondida e consulta na hora quando ela volta", async () => {
    const t = setup([]);
    await settle();
    setHidden(true);
    await advance(10_000);
    expect(t.polls).toHaveLength(0);
    setHidden(false);
    await settle();
    expect(t.polls).toHaveLength(1);
  });

  it("falha de rede: tenta de novo com espera maior e na terceira mostra o erro", async () => {
    const t = setup([{ fail: true }, { fail: true }, { fail: true }]);
    await settle();
    await advance(2_000);
    expect(t.hook.result.current.phase).toBe("waiting");
    await advance(4_000);
    expect(t.hook.result.current.phase).toBe("waiting");
    await advance(8_000);
    expect(t.hook.result.current).toMatchObject({ phase: "error", error: "rede" });
    await advance(30_000);
    expect(t.polls).toHaveLength(3);
  });

  it("uma falha de rede seguida de sucesso não acumula", async () => {
    const t = setup([{ fail: true }, { body: status("confirmar") }]);
    await settle();
    await advance(2_000);
    await advance(4_000);
    expect(t.hook.result.current.phase).toBe("confirm");
  });

  it("restart descarta o pedido e cria outro", async () => {
    const t = setup([{ body: status("expirado") }]);
    await settle();
    await advance(2_000);
    expect(t.hook.result.current.phase).toBe("expired");
    act(() => t.hook.result.current.restart());
    await settle();
    expect(t.created()).toBe(2);
    expect(t.hook.result.current.phase).toBe("waiting");
  });

  it("não entrar: token recusado pelo Supabase vira erro e não avisa que entrou", async () => {
    const t = setup([{ body: status("aprovado", { tokenHash: "tok" }) }], { exchange: async () => ({ error: "x" }) });
    await settle();
    await advance(2_000);
    expect(t.hook.result.current).toMatchObject({ phase: "error", error: "generico" });
    expect(t.onSignedIn).not.toHaveBeenCalled();
  });

  it("limite de tentativas: espera o tempo pedido e continua", async () => {
    const t = setup([{ status: 429, body: { error: "muitas_tentativas", retryAfterSeconds: 10 } }, { body: status("confirmar") }]);
    await settle();
    await advance(2_000);
    await advance(9_000);
    expect(t.polls).toHaveLength(1);
    await advance(1_500);
    expect(t.hook.result.current.phase).toBe("confirm");
  });

  it("falha ao criar o pedido: erro com o motivo e sem consultar", async () => {
    const fn = vi.fn(async () => new Response(JSON.stringify({ error: "login_desabilitado" }), { status: 503 }));
    const hook = renderHook(() =>
      useQrLogin({ enabled: true, apiBaseUrl: "http://api.test", exchangeToken: async () => ({ error: null }), onSignedIn: () => undefined, fetch: fn as never }),
    );
    await settle();
    expect(hook.result.current).toMatchObject({ phase: "error", error: "login_desabilitado", deepLink: null });
    await advance(10_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("ao desmontar a consulta para de vez", async () => {
    const t = setup([]);
    await settle();
    await advance(2_000);
    const calls = t.polls.length;
    t.hook.unmount();
    await advance(30_000);
    expect(t.polls).toHaveLength(calls);
  });
});
