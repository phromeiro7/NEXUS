import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { AuthProvider, useAuth, type AuthContextValue } from "./auth-provider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

let auth: AuthContextValue;
function Grab() {
  auth = useAuth();
  return null;
}

async function setup(metadata?: { display_name?: unknown }) {
  const f = fakeSupabase({ session: { access_token: "t", user: { id: "u1", user_metadata: metadata } } });
  render(
    <AuthProvider client={f.client} apiBaseUrl="http://api.test">
      <Grab />
    </AuthProvider>,
  );
  await waitFor(() => expect(auth.status).toBe("signedIn"));
  return f;
}

describe("nome de exibição", () => {
  it("lê o nome da sessão", async () => {
    await setup({ display_name: "  Paulo " });
    expect(auth.displayName).toBe("Paulo");
  });

  it("ignora valor que não é texto ou está vazio", async () => {
    await setup({ display_name: 42 });
    expect(auth.displayName).toBeNull();
  });

  it("salva o nome aparado e limitado a 40 caracteres", async () => {
    const f = await setup();
    await act(async () => {
      await auth.saveDisplayName(`  ${"a".repeat(60)}  `);
    });
    expect(f.auth.updateUser).toHaveBeenCalledWith({ data: { display_name: "a".repeat(40) } });
    expect(auth.displayName).toBe("a".repeat(40));
  });

  it("nome vazio remove", async () => {
    const f = await setup({ display_name: "Paulo" });
    await act(async () => {
      await auth.saveDisplayName("   ");
    });
    expect(f.auth.updateUser).toHaveBeenCalledWith({ data: { display_name: null } });
    expect(auth.displayName).toBeNull();
  });

  it("devolve erro e mantém o nome se o servidor falhar", async () => {
    const f = await setup({ display_name: "Paulo" });
    f.auth.updateUser.mockResolvedValueOnce({ data: {}, error: { message: "x" } });
    let result: { error: string | null } = { error: null };
    await act(async () => {
      result = await auth.saveDisplayName("Ana");
    });
    expect(result.error).not.toBeNull();
    expect(auth.displayName).toBe("Paulo");
  });
});
