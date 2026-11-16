import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/mini/toast";
import { SettingsPanel } from "./settings-panel";

const holder = vi.hoisted(() => ({
  signOut: vi.fn(),
  saveDisplayName: vi.fn(),
  api: { getSettings: vi.fn(), updateSettings: vi.fn(), createLinkCode: vi.fn(), unlinkTelegram: vi.fn() },
}));
vi.mock("@/components/auth-provider", () => ({
  DISPLAY_NAME_MAX: 40,
  useApi: () => holder.api,
  useAuth: () => ({ displayName: "Ana", saveDisplayName: holder.saveDisplayName, signOut: holder.signOut }),
}));

const settings = { timezone: "America/Sao_Paulo", earlyReminderMinutes: 15, briefingTime: "08:00", telegramLinked: true, channelPaused: false, uf: null };

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SettingsPanel />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  holder.signOut.mockReset();
  holder.saveDisplayName.mockReset().mockResolvedValue({ error: null });
  holder.api.getSettings.mockReset().mockResolvedValue(settings);
  holder.api.updateSettings.mockReset().mockResolvedValue({ settings, skipped: [] });
  holder.api.createLinkCode.mockReset();
  holder.api.unlinkTelegram.mockReset();
});

describe("SettingsPanel", () => {
  it("tem as seções de nome, horários, Telegram e sessão, e nada do painel jurídico", async () => {
    renderPanel();
    expect(await screen.findByRole("heading", { level: 1, name: "Configurações" })).toBeInTheDocument();
    for (const name of ["Como quer ser chamado", "Horários e avisos", "Telegram", "Sessão"]) expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    expect(screen.queryByText(/feriado|UF|jurídic/i)).not.toBeInTheDocument();
  });

  it("salva o nome de exibição", async () => {
    renderPanel();
    const input = await screen.findByLabelText("Como você quer ser chamado?");
    expect(input).toHaveValue("Ana");
    await userEvent.clear(input);
    await userEvent.type(input, "Paulinho");
    await userEvent.click(screen.getByRole("button", { name: "Salvar nome" }));
    await waitFor(() => expect(holder.saveDisplayName).toHaveBeenCalledWith("Paulinho"));
  });

  it("carrega o fuso, a antecedência e o horário do resumo e só salva o que mudou", async () => {
    renderPanel();
    const save = await screen.findByRole("button", { name: "Salvar alterações" });
    expect(save).toBeDisabled();
    expect(screen.getByLabelText("Fuso horário")).toHaveValue("America/Sao_Paulo");
    expect(screen.getByLabelText("Horário do resumo do dia")).toHaveValue("08:00");
    await userEvent.selectOptions(screen.getByLabelText("Avisar com antecedência"), "30");
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(holder.api.updateSettings).toHaveBeenCalledWith({ earlyReminderMinutes: 30 }));
  });

  it("mostra o estado do Telegram (vinculado) com o botão de desvincular", async () => {
    renderPanel();
    const card = await screen.findByTestId("telegram-card");
    expect(within(card).getByText("Telegram vinculado")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Desvincular" })).toBeInTheDocument();
  });

  it("sem vínculo, oferece o código", async () => {
    holder.api.getSettings.mockResolvedValue({ ...settings, telegramLinked: false });
    renderPanel();
    const card = await screen.findByTestId("telegram-card");
    expect(within(card).getByRole("button", { name: /código/i })).toBeInTheDocument();
  });

  it("Sair deste computador encerra a sessão", async () => {
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Sair deste computador" }));
    expect(holder.signOut).toHaveBeenCalledTimes(1);
  });

  it("falha ao carregar avisa na seção de horários", async () => {
    holder.api.getSettings.mockRejectedValue(new Error("rede"));
    renderPanel();
    expect(await screen.findByText(/Não foi possível carregar as configurações/)).toBeInTheDocument();
  });
});
