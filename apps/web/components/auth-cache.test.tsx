import { act, render, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { AuthProvider, useAuth, type AuthContextValue } from "./auth-provider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const A = { access_token: "ta", user: { id: "user-A" } };
const B = { access_token: "tb", user: { id: "user-B" } };
const KEY = ["tasks"];
const ROWS_A = [{ id: "a1", title: "Tarefa sigilosa de A" }];

let auth: AuthContextValue;
function Grab() {
  auth = useAuth();
  return null;
}

async function setup(apiFetch?: typeof fetch) {
  const f = fakeSupabase({ session: A });
  const qc = new QueryClient();
  render(
    <AuthProvider client={f.client} queryClient={qc} apiBaseUrl="http://api.test" apiFetch={apiFetch}>
      <Grab />
    </AuthProvider>,
  );
  await waitFor(() => expect(auth.status).toBe("signedIn"));
  qc.setQueryData(KEY, ROWS_A);
  return { f, qc };
}

beforeEach(() => vi.clearAllMocks());

describe("cache de consultas e troca de usuário", () => {
  it("signOut esvazia o cache; o próximo usuário não vê as linhas do anterior", async () => {
    const { f, qc } = await setup();
    await act(async () => auth.signOut());
    expect(qc.getQueryData(KEY)).toBeUndefined();
    act(() => f.emit("SIGNED_IN", B));
    expect(qc.getQueryData(KEY)).toBeUndefined();
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });

  it("evento SIGNED_OUT esvazia o cache", async () => {
    const { f, qc } = await setup();
    act(() => f.emit("SIGNED_OUT", null));
    expect(qc.getQueryData(KEY)).toBeUndefined();
  });

  it("401 da API esvazia o cache", async () => {
    const apiFetch = vi.fn(async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    const { qc } = await setup(apiFetch);
    await act(async () => {
      await auth.api.listTasks({}).catch(() => undefined);
    });
    expect(apiFetch).toHaveBeenCalled();
    expect(qc.getQueryData(KEY)).toBeUndefined();
  });

  it("SIGNED_IN do mesmo usuário (volta à aba) preserva o cache", async () => {
    const { f, qc } = await setup();
    act(() => f.emit("SIGNED_IN", { ...A, access_token: "renovado" }));
    act(() => f.emit("INITIAL_SESSION", A));
    act(() => f.emit("TOKEN_REFRESHED", A));
    expect(qc.getQueryData(KEY)).toEqual(ROWS_A);
  });

  it("SIGNED_IN de outro usuário, sem SIGNED_OUT antes, esvazia o cache", async () => {
    const { f, qc } = await setup();
    act(() => f.emit("SIGNED_IN", B));
    expect(qc.getQueryData(KEY)).toBeUndefined();
  });

  it("depois da troca, o novo usuário reanunciado não esvazia de novo", async () => {
    const { f, qc } = await setup();
    act(() => f.emit("SIGNED_IN", B));
    qc.setQueryData(KEY, [{ id: "b1" }]);
    act(() => f.emit("SIGNED_IN", B));
    expect(qc.getQueryData(KEY)).toEqual([{ id: "b1" }]);
  });
});
