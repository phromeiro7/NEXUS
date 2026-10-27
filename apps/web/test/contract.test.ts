import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contratos do painel por varredura de texto: o front só fala com `supabase.auth.*` e com a API,
 * e nunca embute a chave de serviço. Arquivos de teste e artefatos de build ficam de fora.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "coverage", ".turbo"]);
const SKIP_FILE = /\.test\.(ts|tsx)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walk(join(dir, entry.name)));
    } else if (!SKIP_FILE.test(entry.name) && !entry.name.endsWith(".tsbuildinfo")) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const FILES = walk(ROOT).map((f) => ({ path: relative(ROOT, f), text: readFileSync(f, "utf8") }));

function offenders(pattern: RegExp): string[] {
  return FILES.filter((f) => pattern.test(f.text)).map((f) => f.path);
}

describe("contrato: o painel não acessa o banco", () => {
  it("varre os arquivos de código (sanidade da varredura)", () => {
    const paths = FILES.map((f) => f.path);
    expect(paths).toContain("lib/supabase.ts");
    expect(paths).toContain("components/auth-provider.tsx");
    expect(paths.some((p) => p.startsWith("node_modules") || p.startsWith(".next"))).toBe(false);
    expect(paths.some((p) => SKIP_FILE.test(p))).toBe(false);
  });

  it("nenhum .from( ou .rpc( do Supabase (Array.from e similares são permitidos)", () => {
    expect(offenders(/\.rpc\s*\(/)).toEqual([]);
    expect(offenders(/(?<!Array|Buffer|Object|Promise|String)\.from\s*\(/)).toEqual([]);
  });

  it("o único uso do cliente Supabase é supabase.auth (tipo AuthClient só expõe auth)", () => {
    const text = FILES.find((f) => f.path === "lib/supabase.ts")!.text;
    const body = text.slice(text.indexOf("export type AuthClient"), text.indexOf("export type SupabaseEnv"));
    expect(body).toMatch(/auth:\s*\{/);
    expect(body).not.toMatch(/\b(from|rpc|storage|functions|realtime|channel)\b\s*[(:]/);
  });
});

describe("contrato: segredos", () => {
  it("service_role / SERVICE_ROLE não aparecem em apps/web", () => {
    expect(offenders(/service_role/i)).toEqual([]);
  });

  it("o token --color-texto-suave existe no tema claro e no escuro", () => {
    const css = FILES.find((f) => f.path === "app/globals.css")!.text;
    expect(css.match(/--color-texto-suave:/g)).toHaveLength(2);
  });

  it("body não esconde rolagem horizontal (overflow-x: hidden mascara estouro de layout)", () => {
    const css = FILES.find((f) => f.path === "app/globals.css")!.text;
    expect(css).not.toMatch(/overflow-x\s*:\s*hidden/);
  });
});
