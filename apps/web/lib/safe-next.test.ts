import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("aceita caminho interno", () => {
    expect(safeNext("/semana")).toBe("/semana");
    expect(safeNext("/tarefas?x=1")).toBe("/tarefas?x=1");
  });
  it.each([
    "//evil.com",
    "https://x",
    "http://x",
    "/\\evil.com",
    "\\evil.com",
    "javascript:alert(1)",
    "semana",
    "",
    "/a\nb",
  ])("rejeita %j", (v) => {
    expect(safeNext(v)).toBe("/");
  });
  it("trata ausência", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });
});
