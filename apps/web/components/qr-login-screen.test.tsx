import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import qrcode from "qrcode-generator";
import { describe, expect, it, vi } from "vitest";
import type { QrLoginState } from "@/hooks/use-qr-login";
import { QrCode } from "./qr-code";
import { QrLoginScreen } from "./qr-login-screen";

const LINK = "https://t.me/nexus_bot?start=login_abcdefghijklmnopqrstuvwxyz1";
const state = (over: Partial<QrLoginState> = {}): QrLoginState => ({
  phase: "waiting",
  deepLink: LINK,
  error: null,
  retryAfterSeconds: null,
  restart: vi.fn(),
  ...over,
});
const ui = (s: QrLoginState, note?: React.ReactNode) =>
  render(<QrLoginScreen state={s} emailForm={<form aria-label="Formulário de e-mail" />} note={note} />);

describe("QrLoginScreen", () => {
  it("espera: QR, passos, botão para abrir o Telegram e a validade de 3 minutos", () => {
    ui(state());
    expect(screen.getByRole("heading", { level: 1, name: "Entrar no Nexus" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Código QR para entrar no Nexus pelo Telegram/ })).toBeInTheDocument();
    const open = screen.getByRole("link", { name: "Abrir no Telegram" });
    expect(open).toHaveAttribute("href", LINK);
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("status")).toHaveTextContent("Aguardando você ler o código. Ele vale por 3 minutos.");
    expect(screen.queryByRole("button", { name: /Gerar novo código|Tentar de novo/ })).not.toBeInTheDocument();
  });

  it("antes do pedido existir não há QR nem botão, só o aviso", () => {
    ui(state({ phase: "creating", deepLink: null }));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Abrir no Telegram" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Preparando o código…");
  });

  it("confirmar: pede para confirmar no celular e mantém o botão", () => {
    ui(state({ phase: "confirm" }));
    expect(screen.getByRole("status")).toHaveTextContent("Confirme no celular.");
    expect(screen.getByRole("link", { name: "Abrir no Telegram" })).toBeInTheDocument();
  });

  it("entrando: avisa, sem botões", () => {
    ui(state({ phase: "entering" }));
    expect(screen.getByRole("status")).toHaveTextContent("Entrando… Seu painel está abrindo.");
    expect(screen.queryByRole("link", { name: "Abrir no Telegram" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Gerar|Tentar/ })).not.toBeInTheDocument();
  });

  it.each([
    ["expired", "O código expirou.", "Gerar novo código"],
    ["denied", "Ninguém entrou.", "Tentar de novo"],
    ["refused", "Este Telegram ainda não tem acesso ao Nexus.", "Tentar de novo"],
  ] as const)("%s: explica e oferece um novo código", async (phase, text, button) => {
    const s = state({ phase });
    ui(s);
    expect(screen.getByRole("status")).toHaveTextContent(text);
    expect(screen.queryByRole("link", { name: "Abrir no Telegram" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: button }));
    expect(s.restart).toHaveBeenCalledTimes(1);
  });

  it("erro de rede e de limite têm texto próprio e deixam tentar de novo", () => {
    const { unmount } = ui(state({ phase: "error", error: "rede", deepLink: null }));
    expect(screen.getByRole("status")).toHaveTextContent("Sem conexão.");
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
    unmount();
    ui(state({ phase: "error", error: "muitas_tentativas", deepLink: null }));
    expect(screen.getByRole("status")).toHaveTextContent("Muitas tentativas.");
  });

  it("sem o login por Telegram (503) o e-mail e senha já aparece aberto e sem o botão de alternar", () => {
    ui(state({ phase: "error", error: "login_desabilitado", deepLink: null }));
    expect(screen.getByRole("form", { name: "Formulário de e-mail" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Entrar com e-mail e senha|Voltar para o código/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).not.toBeInTheDocument();
  });

  it("o e-mail e senha fica recolhido por padrão e abre e fecha com a alternância", async () => {
    const user = userEvent.setup();
    ui(state());
    const toggle = screen.getByRole("button", { name: "Entrar com e-mail e senha" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("form", { name: "Formulário de e-mail" })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByRole("form", { name: "Formulário de e-mail" })).toBeVisible();
    const back = screen.getByRole("button", { name: "Voltar para o código" });
    expect(back).toHaveAttribute("aria-expanded", "true");
    await user.click(back);
    expect(screen.queryByRole("form", { name: "Formulário de e-mail" })).not.toBeInTheDocument();
  });

  it("mostra a nota recebida (ex.: acesso por convite) e os dois conjuntos de passos", () => {
    ui(state(), <p>Aviso de teste</p>);
    expect(screen.getByText("Aviso de teste")).toBeInTheDocument();
    const lists = screen.getAllByRole("list", { hidden: true });
    expect(lists).toHaveLength(2);
    expect(within(lists[0]!).getAllByRole("listitem", { hidden: true })).toHaveLength(3);
  });
});

/** Reconstrói a matriz de módulos a partir do caminho do SVG (retângulos `M x y h w v1 h-w z`). */
function modulesOf(path: string, size: number): boolean[][] {
  const grid = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  for (const m of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let i = 0; i < w; i += 1) grid[y]![x + i] = true;
  }
  return grid;
}

describe("QrCode", () => {
  it("desenha exatamente os módulos do QR do texto recebido, com a folga de 4 módulos", () => {
    const { container } = render(<QrCode value={LINK} label="QR" />);
    const svg = container.querySelector("svg")!;
    const qr = qrcode(0, "M");
    qr.addData(LINK);
    qr.make();
    const n = qr.getModuleCount();
    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${n + 8} ${n + 8}`);
    const grid = modulesOf(svg.querySelector("path")!.getAttribute("d")!, n + 8);
    for (let r = 0; r < n + 8; r += 1) {
      for (let c = 0; c < n + 8; c += 1) {
        const inside = r >= 4 && c >= 4 && r < n + 4 && c < n + 4;
        expect(grid[r]![c]).toBe(inside ? qr.isDark(r - 4, c - 4) : false);
      }
    }
  });

  it("textos diferentes geram códigos diferentes, e o QR nunca é um <img> de serviço externo", () => {
    const a = render(<QrCode value={LINK} label="QR" />).container;
    const b = render(<QrCode value={LINK + "x"} label="QR" />).container;
    expect(a.querySelector("path")!.getAttribute("d")).not.toBe(b.querySelector("path")!.getAttribute("d"));
    expect(a.querySelector("img")).toBeNull();
    expect(a.innerHTML).not.toMatch(/https?:\/\//);
  });

  it("apagado (dimmed) fica claro para mostrar que já não vale", () => {
    const { container } = render(<QrCode value={LINK} label="QR" dimmed />);
    expect(container.querySelector("svg")).toHaveStyle({ opacity: "0.28" });
  });
});
