import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { AuthProvider, useAuth } from "@/components/auth-provider";
import NovaSenhaPage from "./page";
import RecuperarPage from "../recuperar/page";

const router = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/nova-senha",
  useSearchParams: () => new URLSearchParams(""),
}));

const SESSION = { access_token: "t", user: { id: "user-A" } };

beforeEach(() => {
  router.replace.mockReset();
  window.location.hash = "";
});
afterEach(() => {
  window.location.hash = "";
});

function Probe() {
  return <span data-testid="rec">{String(useAuth().recovery)}</span>;
}

type Fake =ReturnType<typeof fakeSupabase>;

function renderPage(f: Fake) {
  return render(
    <AuthProvider client={f.client}>
      <NovaSenhaPage />
    </AuthProvider>,
  );
}

/** Página aberta pelo link do e-mail: sessão + evento PASSWORD_RECOVERY. */
async function renderRecovery(f: Fake = fakeSupabase({ session: SESSION })) {
  renderPage(f);
  await waitFor(() => expect(f.auth.onAuthStateChange).toHaveBeenCalled());
  act(() => f.emit("PASSWORD_RECOVERY", SESSION));
  await screen.findByLabelText("Nova senha");
  return f;
}

async function fill(user: ReturnType<typeof userEvent.setup>, a: string, b: string) {
  await user.type(await screen.findByLabelText("Nova senha"), a);
  await user.type(screen.getByLabelText("Confirmar senha"), b);
}

describe("Nova senha: acesso só pela sessão de recuperação", () => {
  it("logado sem o evento PASSWORD_RECOVERY: sem formulário, com links", async () => {
    const f = fakeSupabase({ session: SESSION });
    renderPage(f);
    expect(await screen.findByText("Este link só funciona a partir do e-mail de recuperação.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nova senha")).toBeNull();
    expect(screen.getByRole("link", { name: "Configurações" })).toHaveAttribute("href", "/configuracoes");
    expect(screen.getByRole("link", { name: "Pedir novo link" })).toHaveAttribute("href", "/recuperar");
    expect(f.auth.updateUser).not.toHaveBeenCalled();
  });

  it("INITIAL_SESSION, SIGNED_IN e TOKEN_REFRESHED com sessão não liberam o formulário", async () => {
    const f = fakeSupabase({ session: SESSION });
    renderPage(f);
    await waitFor(() => expect(f.auth.onAuthStateChange).toHaveBeenCalled());
    for (const event of ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"]) {
      act(() => f.emit(event, SESSION));
    }
    expect(await screen.findByText("Este link só funciona a partir do e-mail de recuperação.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nova senha")).toBeNull();
  });

  it("SIGNED_IN (outra conta, sem sair) encerra a recuperação: o formulário some", async () => {
    const f = await renderRecovery();
    act(() => f.emit("SIGNED_IN", { access_token: "outra", user: { id: "user-B" } }));
    expect(await screen.findByText("Este link só funciona a partir do e-mail de recuperação.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nova senha")).toBeNull();
  });

  it("SIGNED_IN do mesmo usuário (volta à aba, outra aba) mantém o formulário e o que foi digitado", async () => {
    const f = await renderRecovery();
    const user = userEvent.setup();
    await fill(user, "senha1234", "senha12");
    act(() => f.emit("SIGNED_IN", { access_token: "renovado", user: { id: "user-A" } }));
    act(() => f.emit("SIGNED_IN", SESSION));
    expect(screen.getByLabelText("Nova senha")).toHaveValue("senha1234");
    expect(screen.getByLabelText("Confirmar senha")).toHaveValue("senha12");
    expect(screen.queryByText("Este link só funciona a partir do e-mail de recuperação.")).toBeNull();
  });

  it("com o evento PASSWORD_RECOVERY mostra o formulário", async () => {
    await renderRecovery();
    expect(screen.getByLabelText("Confirmar senha")).toBeInTheDocument();
  });

  it("evento chegando depois da sessão: não pisca a mensagem de link inválido", async () => {
    const f = fakeSupabase({ session: SESSION });
    renderPage(f);
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(f.auth.onAuthStateChange).toHaveBeenCalled());
    act(() => f.emit("PASSWORD_RECOVERY", SESSION));
    expect(await screen.findByLabelText("Nova senha")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("erro no fragmento da URL com sessão existente: mensagem de link expirado, sem formulário", async () => {
    window.location.hash = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid";
    const f = fakeSupabase({ session: SESSION });
    renderPage(f);
    expect(await screen.findByRole("alert")).toHaveTextContent("link de recuperação");
    expect(screen.queryByLabelText("Nova senha")).toBeNull();
    expect(screen.getByRole("link", { name: "Pedir novo link" })).toHaveAttribute("href", "/recuperar");
    // O conteúdo do fragmento nunca é exibido.
    expect(document.body.textContent).not.toMatch(/otp_expired|access_denied|invalid/);
  });

  it("erro no fragmento vence até o evento de recuperação", async () => {
    window.location.hash = "#error_code=otp_expired";
    const f = fakeSupabase({ session: SESSION });
    renderPage(f);
    await waitFor(() => expect(f.auth.onAuthStateChange).toHaveBeenCalled());
    act(() => f.emit("PASSWORD_RECOVERY", SESSION));
    expect(await screen.findByRole("alert")).toHaveTextContent("link de recuperação");
    expect(screen.queryByLabelText("Nova senha")).toBeNull();
  });

  it("depois do sucesso a flag de recuperação é limpa no provedor", async () => {
    const f = fakeSupabase({ session: SESSION });
    render(
      <AuthProvider client={f.client}>
        <NovaSenhaPage />
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(f.auth.onAuthStateChange).toHaveBeenCalled());
    act(() => f.emit("PASSWORD_RECOVERY", SESSION));
    await screen.findByLabelText("Nova senha");
    expect(screen.getByTestId("rec")).toHaveTextContent("true");
    const user = userEvent.setup();
    await fill(user, "senha1234", "senha1234");
    await user.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(screen.getByTestId("rec")).toHaveTextContent("false");
  });

  it("SIGNED_OUT limpa a recuperação", async () => {
    const f = await renderRecovery();
    act(() => f.emit("SIGNED_OUT", null));
    expect(await screen.findByRole("alert")).toHaveTextContent("link de recuperação");
    expect(screen.queryByLabelText("Nova senha")).toBeNull();
  });
});


describe("Nova senha", () => {
  it("senhas diferentes: bloqueia e não chama o Supabase", async () => {
    const f = await renderRecovery();
    const user = userEvent.setup();
    await fill(user, "senha1234", "senha9999");
    await user.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("As senhas não conferem.");
    expect(f.auth.updateUser).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("senha curta: bloqueia e não chama o Supabase", async () => {
    const f = await renderRecovery();
    const user = userEvent.setup();
    await fill(user, "1234567", "1234567");
    await user.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("pelo menos 8 caracteres");
    expect(f.auth.updateUser).not.toHaveBeenCalled();
  });

  it("sucesso: atualiza uma vez, mostra confirmação e vai ao Painel", async () => {
    const f = await renderRecovery();
    const user = userEvent.setup();
    await fill(user, "senha1234", "senha1234");
    await user.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(f.auth.updateUser).toHaveBeenCalledTimes(1);
    expect(f.auth.updateUser).toHaveBeenCalledWith({ password: "senha1234" });
    expect(screen.getByRole("status")).toHaveTextContent("Senha atualizada");
  });

  it("sem sessão (link expirado ou inválido): mensagem clara com link para /recuperar", async () => {
    const f = fakeSupabase({ session: null });
    renderPage(f);
    expect(await screen.findByRole("alert")).toHaveTextContent("link de recuperação");
    expect(screen.getByRole("link", { name: "Pedir novo link" })).toHaveAttribute("href", "/recuperar");
    expect(screen.queryByLabelText("Nova senha")).toBeNull();
    expect(f.auth.updateUser).not.toHaveBeenCalled();
  });

  it("enquanto verifica o link não mostra o formulário nem o erro", () => {
    const f = fakeSupabase({ pendingSession: true });
    renderPage(f);
    expect(screen.getByRole("status")).toHaveTextContent("Verificando");
    expect(screen.queryByLabelText("Nova senha")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("duplo envio síncrono: só uma chamada ao Supabase", async () => {
    const f = await renderRecovery();
    f.auth.updateUser.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    await fill(user, "senha1234", "senha1234");
    const form = screen.getByRole("button", { name: "Salvar nova senha" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(f.auth.updateUser).toHaveBeenCalledTimes(1);
  });

  it("erro da API: mostra mensagem, mantém o formulário e não redireciona", async () => {
    const f = await renderRecovery();
    f.auth.updateUser.mockResolvedValue({
      data: {},
      error: { code: "same_password", status: 422, message: "New password should be different" },
    });
    const user = userEvent.setup();
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
