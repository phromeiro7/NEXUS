import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/components/auth-provider";
import { fakeSupabase } from "@/test/fake-supabase";
import EntrarPage from "./page";

const router = { replace: vi.fn(), push: vi.fn() };
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/entrar",
  useSearchParams: () => new URLSearchParams(search),
}));

const ID = "3f1c1b8e-6a63-4b0a-9a35-0d3b3f6a4a11";
const SECRET = "s".repeat(43);
const created = { id: ID, pollSecret: SECRET, deepLink: "https://t.me/nexus_bot?start=login_abc123", expiresAt: "2026-11-04T12:03:00.000Z" };
const status = (s: string, extra: object = {}) => ({ status: s, expiresAt: created.expiresAt, ...extra });

function stubApi(polls: object[]) {
  const calls: Array<{ method: string; url: string }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url });
    if (init?.method === "POST") return new Response(JSON.stringify(created), { status: 201 });
    return new Response(JSON.stringify(polls.shift() ?? status("aguardando")), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function mount(initData?: string | null) {
  const f = fakeSupabase();
  render(
    <AuthProvider client={f.client} apiBaseUrl="http://api.test" {...(initData !== undefined ? { initData } : { initData: null })}>
      <EntrarPage />
    </AuthProvider>,
  );
  return f;
}

beforeEach(() => {
  vi.useFakeTimers();
  router.replace.mockReset();
  search = "";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Entrar por QR code", () => {
  it("mostra o QR do link do bot, espera, e ao ser aprovado troca o token e vai para a rota pedida", async () => {
    search = "next=%2Ffinancas";
    const { calls } = stubApi([status("aguardando"), status("confirmar"), status("aprovado", { tokenHash: "token-de-uso-unico" })]);
    const f = mount();
    await advance(0);
    expect(screen.getByRole("img", { name: /Código QR/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir no Telegram" })).toHaveAttribute("href", created.deepLink);
    expect(calls[0]).toEqual({ method: "POST", url: "http://api.test/auth/qr" });

    await advance(2_000);
    await advance(2_000);
    expect(screen.getByRole("status")).toHaveTextContent("Confirme no celular.");
    expect(router.replace).not.toHaveBeenCalled();

    await advance(2_000);
    expect(f.auth.verifyOtp).toHaveBeenCalledExactlyOnceWith({ token_hash: "token-de-uso-unico", type: "magiclink" });
    expect(router.replace).toHaveBeenCalledExactlyOnceWith("/financas");
    // o segredo de consulta nunca foi para uma URL
    expect(calls.every((c) => !c.url.includes(SECRET))).toBe(true);
  });

  it("'Não fui eu': mostra que ninguém entrou e permite gerar outro pedido", async () => {
    const { calls } = stubApi([status("negado")]);
    mount();
    await advance(0);
    await advance(2_000);
    expect(screen.getByRole("status")).toHaveTextContent("Ninguém entrou.");
    expect(router.replace).not.toHaveBeenCalled();
    await act(async () => screen.getByRole("button", { name: "Tentar de novo" }).click());
    await advance(0);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("Aguardando você ler o código.");
  });

  it("não deixa o token trocado se o Supabase recusar: a pessoa vê erro e não é levada adiante", async () => {
    stubApi([status("aprovado", { tokenHash: "tok" })]);
    const f = fakeSupabase();
    f.auth.verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: { message: "Token has expired" } });
    render(
      <AuthProvider client={f.client} apiBaseUrl="http://api.test" initData={null}>
        <EntrarPage />
      </AuthProvider>,
    );
    await advance(0);
    await advance(2_000);
    expect(screen.getByRole("status")).toHaveTextContent("Não foi possível entrar.");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("dentro do Telegram não cria pedido de QR: só o e-mail e senha de reserva", async () => {
    const { fn } = stubApi([]);
    mount("auth_date=1&user=%7B%22id%22%3A7%7D&hash=aaa");
    await advance(5_000);
    // A entrada automática do Telegram é do provedor; nenhum pedido de QR é criado.
    expect(fn.mock.calls.some(([url]) => String(url).includes("/auth/qr"))).toBe(false);
    expect(screen.queryByRole("img", { name: /Código QR/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("E-mail")).toBeInTheDocument();
  });

  it("sem o Telegram configurado na API o e-mail e senha já vem aberto", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "login_desabilitado" }), { status: 503 })));
    mount();
    await advance(0);
    expect(screen.getByLabelText("E-mail")).toBeInTheDocument();
    expect(screen.getByLabelText("Senha")).toBeInTheDocument();
  });

  it("ao sair da página a consulta para", async () => {
    const { calls } = stubApi([]);
    const f = fakeSupabase();
    const view = render(
      <AuthProvider client={f.client} apiBaseUrl="http://api.test" initData={null}>
        <EntrarPage />
      </AuthProvider>,
    );
    await advance(0);
    await advance(2_000);
    const before = calls.length;
    view.unmount();
    await advance(30_000);
    expect(calls).toHaveLength(before);
  });
});
