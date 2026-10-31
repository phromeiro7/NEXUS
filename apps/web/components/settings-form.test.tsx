import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SettingsDto, UpdateSettingsResultDto } from "@aj/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { SettingsForm } from "./settings-form";

const api = { updateSettings: vi.fn() };
vi.mock("@/components/auth-provider", () => ({ useApi: () => api }));

const SETTINGS: SettingsDto = {
  timezone: "America/Sao_Paulo",
  uf: "SP",
  city: "São Paulo",
  earlyReminderMinutes: 60,
  briefingTime: "08:00",
  telegramLinked: false,
  channelPaused: false,
};

function result(over: Partial<UpdateSettingsResultDto> = {}): UpdateSettingsResultDto {
  return { settings: SETTINGS, remindersRebuilt: 0, remindersSkipped: 0, skipped: [], ...over };
}

function setup(settings: SettingsDto = SETTINGS) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const ui = (s: SettingsDto) => (
    <QueryClientProvider client={client}>
      <SettingsForm settings={s} />
    </QueryClientProvider>
  );
  const view = render(ui(settings));
  return { spy, rerender: (s: SettingsDto) => view.rerender(ui(s)) };
}

const save = () => fireEvent.click(screen.getByRole("button", { name: "Salvar configurações" }));

beforeEach(() => {
  vi.resetAllMocks();
  api.updateSettings.mockResolvedValue(result());
});

describe("SettingsForm", () => {
  it("alterar só a cidade envia exatamente { city }", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Campinas" } });
    save();
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
    expect(api.updateSettings).toHaveBeenCalledWith({ city: "Campinas" });
  });

  it("mudar o fuso envia exatamente { timezone }", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Fuso horário"), { target: { value: "America/Manaus" } });
    save();
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ timezone: "America/Manaus" }));
  });

  it("formulário inalterado não envia nada e avisa", () => {
    setup();
    save();
    expect(api.updateSettings).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Nenhuma alteração para salvar.");
  });

  it("garante o fuso atual na lista mesmo que não conste de supportedValuesOf", () => {
    setup({ ...SETTINGS, timezone: "Etc/Exotico" });
    expect(screen.getByLabelText("Fuso horário")).toHaveValue("Etc/Exotico");
  });

  it("UF 'Não informar' envia { uf: null }", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("UF"), { target: { value: "" } });
    save();
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ uf: null }));
  });

  it("fuso inválido bloqueia o envio com erro no campo", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Fuso horário"), { target: { value: "Marte/Base" } });
    save();
    expect(api.updateSettings).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Fuso horário")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Fuso horário inválido.");
  });

  it("antecedência 1441 bloqueia o envio com erro no campo", () => {
    setup();
    const field = screen.getByLabelText(/Antecedência/);
    fireEvent.change(field, { target: { value: "1441" } });
    save();
    expect(api.updateSettings).not.toHaveBeenCalled();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("entre 0 e 1440");
  });

  it("mostra quantos lembretes foram refeitos", async () => {
    api.updateSettings.mockResolvedValue(result({ remindersRebuilt: 7 }));
    setup();
    fireEvent.change(screen.getByLabelText(/Antecedência/), { target: { value: "30" } });
    save();
    expect(await screen.findByRole("status")).toHaveTextContent("7 lembretes refeitos");
    expect(api.updateSettings).toHaveBeenCalledWith({ earlyReminderMinutes: 30 });
  });

  it("skipped não vazio mostra título, motivo e que os lembretes anteriores foram mantidos", async () => {
    api.updateSettings.mockResolvedValue(
      result({
        remindersRebuilt: 2,
        remindersSkipped: 1,
        skipped: [{ id: "t9", title: "Audiência X", reason: "hora_inexistente" }],
      }),
    );
    setup();
    fireEvent.change(screen.getByLabelText("Fuso horário"), { target: { value: "America/Manaus" } });
    save();
    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent("Audiência X");
    expect(warning).toHaveTextContent("a hora não existe neste fuso");
    expect(warning).toHaveTextContent("manteve os lembretes anteriores");
    expect(warning).toHaveTextContent("horário revisado");
  });

  it("várias tarefas puladas: todas listadas, no plural", async () => {
    api.updateSettings.mockResolvedValue(
      result({
        skipped: [
          { id: "a", title: "Prazo A", reason: "hora_inexistente" },
          { id: "b", title: "Prazo B", reason: "hora_ambigua" },
        ],
      }),
    );
    setup();
    fireEvent.change(screen.getByLabelText("Fuso horário"), { target: { value: "America/Manaus" } });
    save();
    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent("Prazo A");
    expect(warning).toHaveTextContent("Prazo B");
    expect(warning).toHaveTextContent("mantiveram os lembretes anteriores");
  });

  it("motivo hora_ambigua em palavras", async () => {
    api.updateSettings.mockResolvedValue(
      result({ skipped: [{ id: "t9", title: "Prazo Y", reason: "hora_ambigua" }] }),
    );
    setup();
    fireEvent.change(screen.getByLabelText("Fuso horário"), { target: { value: "America/Manaus" } });
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("a hora é ambígua neste fuso");
  });

  it("erro da API aparece em alert e não limpa o que foi digitado", async () => {
    api.updateSettings.mockRejectedValue(new ApiError(0, "rede", null));
    setup();
    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Campinas" } });
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão com o servidor.");
    expect(screen.getByLabelText("Cidade")).toHaveValue("Campinas");
  });

  it("desabilita o envio enquanto pendente (sem envio duplo)", async () => {
    let resolve: (v: UpdateSettingsResultDto) => void = () => {};
    api.updateSettings.mockReturnValue(new Promise((r) => (resolve = r)));
    setup();
    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Campinas" } });
    save();
    const button = await screen.findByRole("button", { name: "Salvando…" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(api.updateSettings).toHaveBeenCalledTimes(1);
    resolve(result());
    await screen.findByRole("status");
  });

  it("mudar o fuso invalida ['tasks'] e ['briefing']", async () => {
    const { spy } = setup();
    fireEvent.change(screen.getByLabelText("Fuso horário"), { target: { value: "America/Manaus" } });
    save();
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["tasks"] }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["briefing"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["settings"] });
  });

  it("mudar só a cidade invalida apenas ['settings']", async () => {
    const { spy } = setup();
    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Campinas" } });
    save();
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["settings"] }));
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["tasks"] });
  });

  it("após salvar, um segundo salvamento envia só a nova alteração", async () => {
    const { rerender } = setup();
    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Campinas" } });
    save();
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
    await screen.findByRole("status");
    // Sem o refetch (props antigas) e com ele (props novas) o resultado é o mesmo.
    rerender({ ...SETTINGS, city: "Campinas" });
    fireEvent.change(screen.getByLabelText(/Antecedência/), { target: { value: "30" } });
    save();
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(2));
    expect(api.updateSettings).toHaveBeenLastCalledWith({ earlyReminderMinutes: 30 });
  });

  it("segundo salvamento sem refetch também não reenvia o campo já salvo", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Campinas" } });
    save();
    await screen.findByRole("status");
    fireEvent.change(screen.getByLabelText(/Antecedência/), { target: { value: "30" } });
    save();
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(2));
    expect(api.updateSettings).toHaveBeenLastCalledWith({ earlyReminderMinutes: 30 });
  });

  it("novas props para campo não editado atualizam o input e não são reenviadas", async () => {
    const { rerender } = setup();
    rerender({ ...SETTINGS, city: "Santos", briefingTime: "09:30" });
    expect(screen.getByLabelText("Cidade")).toHaveValue("Santos");
    expect(screen.getByLabelText("Hora do briefing")).toHaveValue("09:30");
    fireEvent.change(screen.getByLabelText(/Antecedência/), { target: { value: "15" } });
    save();
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
    expect(api.updateSettings).toHaveBeenCalledWith({ earlyReminderMinutes: 15 });
  });

  it("campo editado mantém o valor digitado quando as props mudam", async () => {
    const { rerender } = setup();
    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Campinas" } });
    rerender({ ...SETTINGS, city: "Santos", uf: "RJ" });
    expect(screen.getByLabelText("Cidade")).toHaveValue("Campinas");
    expect(screen.getByLabelText("UF")).toHaveValue("RJ");
    save();
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
    expect(api.updateSettings).toHaveBeenCalledWith({ city: "Campinas" });
  });

  it("seção Telegram mostra o estado e o aviso, sem botão", () => {
    setup({ ...SETTINGS, telegramLinked: true });
    expect(screen.getByText("Telegram vinculado")).toBeInTheDocument();
    expect(screen.getByText("Vínculo disponível em breve")).toBeInTheDocument();
  });
});
