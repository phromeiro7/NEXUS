import { describe, expect, it } from "vitest";
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

describe("readApiUrl", () => {
  it("usa o padrão local", () => {
    expect(readApiUrl(undefined)).toBe("http://localhost:3001");
    expect(readApiUrl("http://api.test")).toBe("http://api.test");
  });
});
