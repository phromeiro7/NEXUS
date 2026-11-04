import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/components/auth-provider";
import { fakeSupabase } from "@/test/fake-supabase";
import { MiniGate } from "./mini-gate";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/mini",
  useSearchParams: () => new URLSearchParams(),
}));

const INIT = "auth_date=1&user=%7B%22id%22%3A7%7D&hash=aaa";
const A = { access_token: "ta", user: { id: "user-A" } };

function mount(opts: { sessions: Array<typeof A | null>; fetchFn?: ReturnType<typeof vi.fn>; initData?: string | null }) {
  const f = fakeSupabase();
  const queue = [...opts.sessions];
  f.auth.getSession.mockImplementation(() =>
    Promise.resolve({ data: { session: (queue.length > 1 ? queue.shift() : queue[0]) ?? null } }),
  );
  const fetchFn =
    opts.fetchFn ?? vi.fn(async () => new Response(JSON.stringify({ tokenHash: "tok" }), { status: 200 }));
  render(
    <AuthProvider
      client={f.client}
      apiBaseUrl="http://api.test"
      apiFetch={fetchFn as unknown as typeof fetch}
      initData={opts.initData === undefined ? INIT : opts.initData}
    >
      <MiniGate>
        <p>Conteúdo do Hoje</p>
      </MiniGate>
    </AuthProvider>,
  );
  return { f, fetchFn };
}

const refuse = (status: number, error: string) =>
  vi.fn(async () => new Response(JSON.stringify({ error }), { status }));

beforeEach(() => {
  window.sessionStorage.clear();
  replace.mockClear();
});

describe("MiniGate", () => {
  it("dentro do Telegram mostra 'Entrando…' e depois o conteúdo, sem ir ao login", async () => {
    const { f } = mount({ sessions: [null, A] });
    act(() => f.emit("INITIAL_SESSION", null));
    expect(screen.getByRole("status")).toHaveTextContent("Entrando…");
    await screen.findByText("Conteúdo do Hoje");
    expect(replace).not.toHaveBeenCalled();
  });

  it("fora do Telegram, sem sessão, vai para o login como sempre", async () => {
    mount({ sessions: [null], initData: null });
    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringMatching(/^\/entrar\?next=/)));
  });

  it("Telegram sem conta ligada: explica e oferece e-mail, sem formulário nem redirecionamento", async () => {
    mount({ sessions: [null], fetchFn: refuse(403, "telegram_nao_vinculado") });
    expect(await screen.findByRole("heading", { name: /ainda não está ligado a uma conta/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Entrar com e-mail" })).toHaveAttribute("href", "/entrar?next=%2Fmini");
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("acesso já usado ou vencido: manda reabrir pelo botão do bot", async () => {
    mount({ sessions: [null], fetchFn: refuse(401, "ja_utilizado") });
    expect(await screen.findByRole("heading", { name: /já não vale/i })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/abra de novo pelo botão do bot/i);
  });

  it("falha de rede: 'Tentar de novo' funciona e entra", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(new Response(JSON.stringify({ tokenHash: "tok" }), { status: 200 }));
    mount({ sessions: [null, null, A], fetchFn });
    expect(await screen.findByRole("heading", { name: "Sem conexão" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await screen.findByText("Conteúdo do Hoje");
  });

  it("depois de sair dentro do Telegram, mostra 'Você saiu' em vez de reentrar", async () => {
    window.sessionStorage.setItem("nexus.tg.optout", INIT);
    mount({ sessions: [null] });
    expect(await screen.findByRole("heading", { name: "Você saiu do Nexus" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Entrar com e-mail" })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("nunca mostra o initData nem o token na tela", async () => {
    mount({ sessions: [null], fetchFn: refuse(401, "assinatura_invalida") });
    await screen.findByRole("alert");
    expect(document.body.textContent).not.toMatch(/hash=|aaa|tok/);
  });
});
