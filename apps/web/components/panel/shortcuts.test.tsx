import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/mini/toast";
import { CaptureBar } from "./capture-bar";
import { Dialog } from "./dialog";
import { ShortcutsProvider } from "./shortcuts";

const holder = vi.hoisted(() => ({ api: {} as Record<string, unknown> }));
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ userId: "u1" }),
  useApi: () => holder.api,
}));

function renderWith(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ShortcutsProvider>
          <button type="button">antes</button>
          {ui}
        </ShortcutsProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  holder.api = { listFinanceEntries: vi.fn().mockResolvedValue([]), createTask: vi.fn(), deleteTask: vi.fn(), interpretCapture: vi.fn() };
});

describe("atalhos de teclado", () => {
  it("/ leva o foco para a barra de captura", async () => {
    renderWith(<CaptureBar />);
    await userEvent.keyboard("/");
    expect(screen.getByLabelText("Anotar tarefa, gasto ou conta")).toHaveFocus();
  });

  it("N abre a nova tarefa e Esc fecha, devolvendo o foco a quem estava", async () => {
    renderWith(<CaptureBar />);
    const before = screen.getByRole("button", { name: "antes" });
    before.focus();
    await userEvent.keyboard("n");
    const dialog = await screen.findByRole("dialog", { name: "Nova tarefa" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("O que precisa ser feito")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(before).toHaveFocus();
  });

  it("? mostra e esconde a lista de atalhos", async () => {
    renderWith(<CaptureBar />);
    expect(screen.queryByRole("region", { name: "Atalhos de teclado" })).not.toBeInTheDocument();
    await userEvent.keyboard("?");
    expect(screen.getByRole("region", { name: "Atalhos de teclado" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Atalhos de teclado" })).not.toBeInTheDocument();
  });

  it("o botão Atalhos faz o mesmo e informa se está aberto", async () => {
    renderWith(<CaptureBar />);
    const button = screen.getByRole("button", { name: /Atalhos/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "Atalhos de teclado" })).toBeInTheDocument();
  });

  it("não aciona nada enquanto a pessoa digita num campo", async () => {
    renderWith(<CaptureBar />);
    await userEvent.type(screen.getByLabelText("Anotar tarefa, gasto ou conta"), "n/?");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Atalhos de teclado" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Anotar tarefa, gasto ou conta")).toHaveValue("n/?");
  });

  it("não aciona com Ctrl, Cmd ou Alt", async () => {
    renderWith(<CaptureBar />);
    await userEvent.keyboard("{Control>}n{/Control}");
    await userEvent.keyboard("{Meta>}/{/Meta}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Anotar tarefa, gasto ou conta")).not.toHaveFocus();
  });

  it("fora de Hoje e Finanças (sem barra de captura) as teclas não fazem nada", async () => {
    renderWith(<p>Configurações</p>);
    await userEvent.keyboard("n");
    await userEvent.keyboard("?");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("com um diálogo aberto os atalhos ficam quietos", async () => {
    renderWith(<CaptureBar />);
    await userEvent.keyboard("n");
    await screen.findByRole("dialog");
    await userEvent.keyboard("?");
    expect(screen.queryByRole("region", { name: "Atalhos de teclado" })).not.toBeInTheDocument();
  });
});

describe("Dialog", () => {
  it("prende o Tab dentro do diálogo", async () => {
    const onClose = vi.fn();
    renderWith(
      <Dialog title="Exemplo" onClose={onClose}>
        <input aria-label="primeiro" />
        <button type="button">último</button>
      </Dialog>,
    );
    const close = screen.getByRole("button", { name: "Fechar" });
    expect(screen.getByLabelText("primeiro")).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "último" })).toHaveFocus();
    await userEvent.tab();
    expect(close).toHaveFocus(); // do último volta ao primeiro (o botão Fechar, no cabeçalho)
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "último" })).toHaveFocus(); // e Shift+Tab do primeiro vai ao último
  });

  it("Esc e o clique fora chamam onClose; o clique dentro não", async () => {
    const onClose = vi.fn();
    renderWith(
      <Dialog title="Exemplo" onClose={onClose}>
        <p>dentro</p>
      </Dialog>,
    );
    await userEvent.click(screen.getByText("dentro"));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(document.querySelector(".pn-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
