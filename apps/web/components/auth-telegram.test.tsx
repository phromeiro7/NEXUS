import { act, render, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { AuthProvider, useAuth, type AuthContextValue } from "./auth-provider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/mini",
  useSearchParams: () => new URLSearchParams(),
}));

const INIT = "auth_date=1&user=%7B%22id%22%3A7%7D&hash=aaa";
const A = { access_token: "ta", user: { id: "user-A" } };
const B = { access_token: "tb", user: { id: "user-B" } };

const ok = () => vi.fn(async () => new Response(JSON.stringify({ tokenHash: "tok" }), { status: 200 }));
const refuse = (status: number, error: string) =>
  vi.fn(async () => new Response(JSON.stringify({ error }), { status }));

let auth: AuthContextValue;
const seen: string[] = [];
function Grab() {
  auth = useAuth();
  seen.push(auth.status);
  return null;
}

/** `sessions`: o que getSession devolve a cada chamada (a última se repete). */
function mount(opts: { sessions: Array<typeof A | null>; fetchFn?: ReturnType<typeof vi.fn>; initData?: string | null; qc?: QueryClient }) {
  const f = fakeSupabase();
  const queue = [...opts.sessions];
  f.auth.getSession.mockImplementation(() =>
    Promise.resolve({ data: { session: (queue.length > 1 ? queue.shift() : queue[0]) ?? null } }),
  );
  const fetchFn = opts.fetchFn ?? ok();
  const view = render(
    <AuthProvider
      client={f.client}
      apiBaseUrl="http://api.test"
      apiFetch={fetchFn as unknown as typeof fetch}
      initData={opts.initData === undefined ? INIT : opts.initData}
      {...(opts.qc ? { queryClient: opts.qc } : {})}
    >
      <Grab />
    </AuthProvider>,
  );
  return { f, fetchFn, view };
}

beforeEach(() => {
  window.sessionStorage.clear();
  seen.length = 0;
});

describe("entrada automática pelo Telegram", () => {
  it("sem sessão, troca o initData por uma sessão e NUNCA passa por 'signedOut'", async () => {
    const { f, fetchFn } = mount({ sessions: [null, A] });
    // O Supabase real anuncia "sem sessão" assim que inicia; isso não pode mandar para o login.
    act(() => f.emit("INITIAL_SESSION", null));
    await waitFor(() => expect(auth.status).toBe("signedIn"));
    expect(seen).not.toContain("signedOut");
    expect(f.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "tok", type: "magiclink" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(auth.telegram).toMatchObject({ available: true, phase: "idle", error: null, signedOut: false });
    expect(auth.userId).toBe("user-A");
  });

  it("fora do Telegram nada muda: sem sessão é 'signedOut' e a API não é chamada", async () => {
    const { fetchFn } = mount({ sessions: [null], initData: null });
    await waitFor(() => expect(auth.status).toBe("signedOut"));
    expect(auth.telegram.available).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ["telegram_nao_vinculado", 403],
    ["ja_utilizado", 401],
    ["sessao_expirada", 401],
  ] as const)("falha %s sem sessão: fica 'signedOut' com o motivo à mostra", async (code, status) => {
    const { f } = mount({ sessions: [null], fetchFn: refuse(status, code) });
    await waitFor(() => expect(auth.telegram.phase).toBe("failed"));
    expect(auth.status).toBe("signedOut");
    expect(auth.telegram.error).toBe(code);
    expect(f.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("falha de rede pode ser repetida com o mesmo initData", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(new Response(JSON.stringify({ tokenHash: "tok" }), { status: 200 }));
    mount({ sessions: [null, null, A], fetchFn });
    await waitFor(() => expect(auth.telegram.error).toBe("rede"));
    act(() => auth.telegram.retry());
    await waitFor(() => expect(auth.status).toBe("signedIn"));
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("initData já usado neste uso do app não é enviado de novo (recarregar a página)", async () => {
    window.sessionStorage.setItem("nexus.tg.handled", INIT);
    const { fetchFn } = mount({ sessions: [A] });
    await waitFor(() => expect(auth.status).toBe("signedIn"));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("com sessão de OUTRA conta, a do Telegram vence e o cache da anterior é esvaziado", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["tasks"], [{ id: "sigiloso-de-A" }]);
    mount({ sessions: [A, B], qc });
    await waitFor(() => expect(auth.userId).toBe("user-B"));
    expect(qc.getQueryData(["tasks"])).toBeUndefined();
  });

  it("com sessão aberta, uma falha do Telegram não derruba a sessão nem mostra erro", async () => {
    mount({ sessions: [A], fetchFn: refuse(403, "telegram_nao_vinculado") });
    await waitFor(() => expect(auth.telegram.phase).toBe("idle"));
    await waitFor(() => expect(auth.status).toBe("signedIn"));
    expect(auth.telegram.error).toBeNull();
    expect(auth.userId).toBe("user-A");
  });

  it("sair dentro do Telegram não entra sozinho de novo (sem laço), mas um uso novo entra", async () => {
    const first = mount({ sessions: [A], fetchFn: ok() });
    await waitFor(() => expect(auth.status).toBe("signedIn"));
    await act(async () => auth.signOut());
    expect(auth.status).toBe("signedOut");
    expect(auth.telegram.signedOut).toBe(true);
    first.view.unmount();

    // Reabre o app com o MESMO initData (recarregar): continua fora.
    const again = mount({ sessions: [null], fetchFn: ok() });
    await waitFor(() => expect(auth.telegram.signedOut).toBe(true));
    expect(auth.status).toBe("signedOut");
    expect(again.fetchFn).not.toHaveBeenCalled();
    again.view.unmount();

    // Uso novo do app: outro initData volta a entrar sozinho.
    mount({ sessions: [null, A], initData: `${INIT}&query_id=novo` });
    await waitFor(() => expect(auth.status).toBe("signedIn"));
  });

  it("não registra initData nem token em lugar nenhum", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    mount({ sessions: [null, A] });
    await waitFor(() => expect(auth.status).toBe("signedIn"));
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toMatch(/aaa|tok/);
    spies.forEach((s) => s.mockRestore());
  });
});
