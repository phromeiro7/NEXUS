import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { AuthProvider } from "@/components/auth-provider";
import NovaSenhaPage from "./page";
import RecuperarPage from "../recuperar/page";

const router = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/nova-senha",
  useSearchParams: () => new URLSearchParams(""),
}));

beforeEach(() => {
  router.replace.mockReset();
});

function renderPage(client: ReturnType<typeof fakeSupabase>["client"]) {
  return render(
    <AuthProvider client={client}>
      <NovaSenhaPage />
    </AuthProvider>,
  );
}

async function fill(user: ReturnType<typeof userEvent.setup>, a: string, b: string) {
  await user.type(await screen.findByLabelText("Nova senha"), a);
  await user.type(screen.getByLabelText("Confirmar senha"), b);
}

describe("Nova senha", () => {
  it("senhas diferentes: bloqueia e não chama o Supabase", async () => {
    const { client, auth } = fakeSupabase({ session: { access_token: "t" } });
    const user = userEvent.setup();
    renderPage(client);
    await fill(user, "senha1234", "senha9999");
    await user.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("As senhas não conferem.");
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("senha curta: bloqueia e não chama o Supabase", async () => {
    const { client, auth } = fakeSupabase({ session: { access_token: "t" } });
    const user = userEvent.setup();
    renderPage(client);
    await fill(user, "1234567", "1234567");
    await user.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("pelo menos 8 caracteres");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("sucesso: atualiza uma vez, mostra confirmação e vai ao Painel", async () => {
    const { client, auth } = fakeSupabase({ session: { access_token: "t" } });
    const user = userEvent.setup();
    renderPage(client);
    await fill(user, "senha1234", "senha1234");
    await user.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "senha1234" });
    expect(screen.getByRole("status")).toHaveTextContent("Senha atualizada");
  });

  it("link expirado ou inválido: mensagem clara com link para /recuperar", async () => {
    const { client, auth } = fakeSupabase({ session: null });
    renderPage(client);
    expect(await screen.findByRole("alert")).toHaveTextContent("link de recuperação");
    expect(screen.getByRole("link", { name: "Pedir novo link" })).toHaveAttribute("href", "/recuperar");
    expect(screen.queryByLabelText("Nova senha")).toBeNull();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("enquanto verifica o link não mostra o formulário nem o erro", () => {
    const { client } = fakeSupabase({ pendingSession: true });
    renderPage(client);
    expect(screen.getByRole("status")).toHaveTextContent("Verificando");
    expect(screen.queryByLabelText("Nova senha")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("duplo envio: só uma chamada enquanto a primeira não termina", async () => {
    const { client, auth } = fakeSupabase({ session: { access_token: "t" } });
    auth.updateUser.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderPage(client);
    await fill(user, "senha1234", "senha1234");
    await user.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvando…" })).toBeDisabled());
    await user.type(screen.getByLabelText("Confirmar senha"), "{Enter}");
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
  });

  it("erro da API: mostra mensagem, mantém o formulário e não redireciona", async () => {
    const { client, auth } = fakeSupabase({ session: { access_token: "t" } });
    auth.updateUser.mockResolvedValue({
      data: {},
      error: { code: "same_password", status: 422, message: "New password should be different" },
    });
    const user = userEvent.setup();
    renderPage(client);
    await fill(user, "senha1234", "senha1234");
    await user.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("diferente da atual");
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Salvar nova senha" })).toBeEnabled();
  });
});

describe("Recuperar", () => {
  it("pede o e-mail com redirectTo para /nova-senha", async () => {
    const { client, auth } = fakeSupabase();
    const user = userEvent.setup();
    render(
      <AuthProvider client={client}>
        <RecuperarPage />
      </AuthProvider>,
    );
    await user.type(screen.getByLabelText("E-mail"), "a@b.co");
    await user.click(screen.getByRole("button", { name: "Enviar link" }));
    await waitFor(() => expect(auth.resetPasswordForEmail).toHaveBeenCalledTimes(1));
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("a@b.co", {
      redirectTo: `${window.location.origin}/nova-senha`,
    });
  });
});
