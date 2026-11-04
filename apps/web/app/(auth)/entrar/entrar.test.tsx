import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { AuthProvider } from "@/components/auth-provider";
import EntrarPage from "./page";
import CadastroPage from "../cadastro/page";
import RecuperarPage from "../recuperar/page";

const router = { replace: vi.fn(), push: vi.fn() };
let search = "";
const redirectTo = vi.fn((_url: string): never => {
  throw new Error("NEXT_REDIRECT");
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectTo(url),
  useRouter: () => router,
  usePathname: () => "/entrar",
  useSearchParams: () => new URLSearchParams(search),
}));

// Sem o login por Telegram configurado na API (503), a tela de entrada abre direto no e-mail e senha.
beforeEach(() => {
  router.replace.mockReset();
  search = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: "login_desabilitado" }), { status: 503 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("Entrar", () => {
  it("credenciais erradas: mostra mensagem e mantém o e-mail", async () => {
    const { client, auth } = fakeSupabase();
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { code: "invalid_credentials", status: 400, message: "Invalid login credentials" },
    });
    const user = userEvent.setup();
    render(
      <AuthProvider client={client}>
        <EntrarPage />
      </AuthProvider>,
    );
    await user.type(await screen.findByLabelText("E-mail"), "ana@exemplo.com");
    await user.type(screen.getByLabelText("Senha"), "errada123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("E-mail ou senha incorretos.");
    expect(screen.getByLabelText("E-mail")).toHaveValue("ana@exemplo.com");
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("desabilita o botão durante o envio e usa autocomplete correto", async () => {
    const { client, auth } = fakeSupabase();
    auth.signInWithPassword.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(
      <AuthProvider client={client}>
        <EntrarPage />
      </AuthProvider>,
    );
    expect(await screen.findByLabelText("E-mail")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Senha")).toHaveAttribute("autocomplete", "current-password");
    await user.type(screen.getByLabelText("E-mail"), "a@b.co");
    await user.type(screen.getByLabelText("Senha"), "x");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Entrando…" })).toBeDisabled());
  });

  it.each([
    ["%2Fsemana", "/semana"],
    ["%2F%2Fevil.com", "/"],
    ["https%3A%2F%2Fx", "/"],
  ])("após login, next=%s vai para %s", async (raw, expected) => {
    search = `next=${raw}`;
    const { client } = fakeSupabase();
    const user = userEvent.setup();
    render(
      <AuthProvider client={client}>
        <EntrarPage />
      </AuthProvider>,
    );
    await user.type(await screen.findByLabelText("E-mail"), "a@b.co");
    await user.type(screen.getByLabelText("Senha"), "senha1234");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(expected));
  });
});

describe("Cadastro fechado", () => {
  it("manda quem chega pelo endereço antigo para a entrada, sem formulário", () => {
    expect(() => CadastroPage()).toThrow("NEXT_REDIRECT");
    expect(redirectTo).toHaveBeenCalledWith("/entrar?acesso=convite");
  });

  it("a entrada explica que o acesso é por convite", () => {
    search = "acesso=convite";
    const { client } = fakeSupabase();
    render(
      <AuthProvider client={client}>
        <EntrarPage />
      </AuthProvider>,
    );
    expect(screen.getAllByRole("status").some((el) => el.textContent === "O acesso ao Nexus é por convite.")).toBe(true);
  });

  it("sem o parâmetro não há aviso nem link para criar conta", () => {
    const { client } = fakeSupabase();
    render(
      <AuthProvider client={client}>
        <EntrarPage />
      </AuthProvider>,
    );
    expect(screen.queryByText("O acesso ao Nexus é por convite.")).not.toBeInTheDocument();
    expect(screen.queryByText(/criar conta/i)).not.toBeInTheDocument();
  });
});

describe("Recuperar", () => {
  it("mostra confirmação neutra mesmo se o e-mail não existir", async () => {
    const { client, auth } = fakeSupabase();
    const user = userEvent.setup();
    render(
      <AuthProvider client={client}>
        <RecuperarPage />
      </AuthProvider>,
    );
    await user.type(screen.getByLabelText("E-mail"), "nao@existe.co");
    await user.click(screen.getByRole("button", { name: "Enviar link" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.",
    );
    expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });
});
