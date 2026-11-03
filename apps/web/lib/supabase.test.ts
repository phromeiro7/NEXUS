import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupabase, readApiUrl } from "./supabase";

describe("createSupabase", () => {
  it("nomeia a variável ausente (URL)", () => {
    expect(() => createSupabase({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
  it("nomeia a variável ausente (anon key)", () => {
    expect(() => createSupabase({ url: "http://localhost:1" })).toThrow(
      /NEXT_PUBLIC_SUPABASE_ANON_KEY/,
    );
  });
});

describe("createSupabase sem argumentos (lê process.env sob demanda)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sem NEXT_PUBLIC_SUPABASE_URL lança erro que nomeia a variável", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "chave-secreta-de-teste");
    expect(() => createSupabase()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("sem NEXT_PUBLIC_SUPABASE_ANON_KEY lança erro que nomeia a variável e não imprime valores", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://url-secreta-de-teste:1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    let message = "";
    try {
      createSupabase();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(message).not.toContain("url-secreta-de-teste");
  });
});

describe("readApiUrl", () => {
  it("variável vazia também usa o padrão (validação preguiçosa, sem erro na importação)", () => {
    expect(readApiUrl("")).toBe("http://localhost:3001");
  });

  it("usa o padrão local", () => {
    expect(readApiUrl(undefined)).toBe("http://localhost:3001");
    expect(readApiUrl("http://api.test")).toBe("http://api.test");
  });
});
