import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { createApiClient, ApiError } from "@/lib/api";
import { AuthProvider, useApi } from "./auth-provider";
import { AuthGuard } from "./auth-guard";

const router = { replace: vi.fn(), push: vi.fn() };
let pathname = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  router.replace.mockReset();
  pathname = "/";
});

describe("AuthGuard", () => {
  it("redireciona para /entrar quando deslogado", async () => {
    const { client } = fakeSupabase({ session: null });
    render(
      <AuthProvider client={client}>
        <AuthGuard>
          <p>segredo</p>
        </AuthGuard>
      </AuthProvider>,
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/entrar?next=%2F"));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("segredo")).not.toBeInTheDocument();
  });

  it("em carregamento não redireciona nem mostra os filhos", async () => {
    const { client } = fakeSupabase({ pendingSession: true });
    render(
      <AuthProvider client={client}>
        <AuthGuard>
          <p>segredo</p>
        </AuthGuard>
      </AuthProvider>,
    );
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(screen.queryByText("segredo")).not.toBeInTheDocument();
    await Promise.resolve();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("logado renderiza os filhos", async () => {
    const { client } = fakeSupabase({ session: { access_token: "t" } });
    render(
      <AuthProvider client={client}>
        <AuthGuard>
          <p>segredo</p>
        </AuthGuard>
      </AuthProvider>,
    );
    expect(await screen.findByText("segredo")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("preserva a rota atual em next", async () => {
    pathname = "/semana";
    const { client } = fakeSupabase({ session: null });
    render(
      <AuthProvider client={client}>
        <AuthGuard>
          <p>segredo</p>
        </AuthGuard>
      </AuthProvider>,
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/entrar?next=%2Fsemana"));
  });
});

describe("AuthGuard após mudança de rota", () => {
  it("redireciona de novo ao voltar para uma rota protegida", async () => {
    pathname = "/semana";
    const { client } = fakeSupabase({ session: null });
    const tree = (key: string) => (
      <AuthProvider client={client}>
        <AuthGuard key={key}>
          <p>segredo</p>
        </AuthGuard>
      </AuthProvider>
    );
    const { rerender } = render(tree("a"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    pathname = "/entrar";
    rerender(tree("a"));
    pathname = "/";
    rerender(tree("b")); // o layout (app) remonta ao voltar
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(2));
    expect(router.replace).toHaveBeenLastCalledWith("/entrar?next=%2F");
  });
});

describe("useApi / onUnauthorized", () => {
  function Probe({ onReady }: { onReady: (api: ReturnType<typeof createApiClient>) => void }) {
    const api = useApi();
    onReady(api);
    return null;
  }

  it("401 repetido redireciona uma só vez e faz signOut local", async () => {
    const { client, auth } = fakeSupabase({ session: { access_token: "t" } });
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "nao_autenticado" }), { status: 401 })),
    );
    let api!: ReturnType<typeof createApiClient>;
    pathname = "/semana";
    render(
      <AuthProvider client={client} apiFetch={fetchMock as unknown as typeof fetch} apiBaseUrl="http://api.test">
        <Probe onReady={(a) => (api = a)} />
      </AuthProvider>,
    );
    await waitFor(() => expect(auth.getSession).toHaveBeenCalled());
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/entrar?next=%2Fsemana");
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
