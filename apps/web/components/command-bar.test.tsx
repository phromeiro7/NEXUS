import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { makeTask } from "@/test/factories";
import { CommandBar } from "./command-bar";
import { HighlightProvider } from "./highlight-context";
import { TaskRow } from "./task-row";

const api = { sendAssistantMessage: vi.fn() };
vi.mock("@/components/auth-provider", () => ({ useApi: () => api }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <HighlightProvider>
        <input aria-label="Outro campo" />
        <CommandBar />
        <ul>
          <TaskRow task={makeTask({ id: "t1", title: "Recurso" })} today="2026-10-27" onChange={vi.fn()} />
        </ul>
      </HighlightProvider>
    </QueryClientProvider>,
  );
  return { spy, client };
}

const dialog = () => screen.queryByRole("dialog", { name: "Assistente" });
const field = () => screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(field(), { target: { value } });
const sendBtn = () => screen.getByRole("button", { name: "Enviar" });
const openWithButton = () => fireEvent.click(screen.getByRole("button", { name: /Perguntar ao assistente/ }));

beforeEach(() => vi.resetAllMocks());

describe("CommandBar abertura", () => {
  it("o botão mostra o atalho e abre o diálogo rotulado", () => {
    setup();
    const btn = screen.getByRole("button", { name: /Perguntar ao assistente/ });
    expect(btn).toHaveTextContent("Ctrl K");
    expect(dialog()).toBeNull();
    fireEvent.click(btn);
    expect(dialog()).toBeInTheDocument();
  });

  it.each([
    ["Ctrl+K", { ctrlKey: true }],
    ["Cmd+K", { metaKey: true }],
  ])("%s abre, com preventDefault, mesmo com um campo focado", (_n, mods) => {
    setup();
    const other = screen.getByLabelText("Outro campo");
    other.focus();
    const ev = new KeyboardEvent("keydown", { key: "k", cancelable: true, bubbles: true, ...mods });
    act(() => void other.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(dialog()).toBeInTheDocument();
  });

  it("K sem modificador e repetição não abrem", () => {
    setup();
    fireEvent.keyDown(document, { key: "k" });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true, repeat: true });
    expect(dialog()).toBeNull();
  });

  it("remove o ouvinte global ao desmontar", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const { client } = setup();
    void client;
    const added = add.mock.calls.filter((c) => c[0] === "keydown");
    expect(added.length).toBeGreaterThan(0);
    cleanupAll();
    const removed = remove.mock.calls.filter((c) => c[0] === "keydown");
    expect(removed.map((c) => c[1])).toEqual(expect.arrayContaining(added.map((c) => c[1])));
    add.mockRestore();
    remove.mockRestore();
  });

  it("Escape fecha e devolve o foco ao botão que abriu", () => {
    setup();
    const btn = screen.getByRole("button", { name: /Perguntar ao assistente/ });
    btn.focus();
    openWithButton();
    expect(field()).toHaveFocus();
    const cancel = new Event("cancel", { cancelable: true });
    act(() => void dialog()!.dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog()).toBeNull();
    expect(btn).toHaveFocus();
  });

  it("aberto pelo atalho, devolve o foco ao campo que estava focado", () => {
    setup();
    const other = screen.getByLabelText("Outro campo");
    other.focus();
    fireEvent.keyDown(other, { key: "k", ctrlKey: true });
    expect(dialog()).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(dialog()).toBeNull();
    expect(other).toHaveFocus();
  });
});

describe("CommandBar contador", () => {
  it("mostra N/1000 e bloqueia o envio acima de 1000", () => {
    setup();
    openWithButton();
    expect(screen.getByText("0/1000")).toBeInTheDocument();
    expect(sendBtn()).toBeDisabled();
    type("a".repeat(1000));
    expect(screen.getByText("1000/1000")).toBeInTheDocument();
    expect(sendBtn()).toBeEnabled();
    type("a".repeat(1001));
    expect(screen.getByText("1001/1000")).toBeInTheDocument();
    expect(sendBtn()).toBeDisabled();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(api.sendAssistantMessage).not.toHaveBeenCalled();
  });
});

describe("CommandBar envio", () => {
  const affected = makeTask({ id: "t1", title: "Recurso", type: "prazo", dueDate: "2026-11-05", dueTime: "14:30" });
  const allDay = makeTask({ id: "t2", title: "Petição", type: "audiencia", dueDate: "2026-11-06", dueTime: null });

  it("envia, mostra resposta e tarefas afetadas, destaca a linha e invalida consultas", async () => {
    api.sendAssistantMessage.mockResolvedValue({ reply: "Criei o prazo.", affectedTasks: [affected, allDay] });
    const { spy } = setup();
    openWithButton();
    type("  criar recurso  ");
    fireEvent.click(sendBtn());
    const log = await screen.findByRole("log");
    await waitFor(() => expect(within(log).getByText("Criei o prazo.")).toBeInTheDocument());
    expect(within(log).getByText("criar recurso")).toBeInTheDocument();
    expect(api.sendAssistantMessage).toHaveBeenCalledWith({
      text: "criar recurso",
      clientMessageId: expect.stringMatching(UUID),
    });
    expect(Object.keys(api.sendAssistantMessage.mock.calls[0]![0])).not.toContain("userId");
    const items = within(log).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Recurso");
    expect(items[0]).toHaveTextContent("05/11");
    expect(items[0]).toHaveTextContent("14:30");
    expect(items[0]).toHaveTextContent("Prazo");
    expect(items[0]).toHaveTextContent("Atualizada agora");
    expect(items[1]).toHaveTextContent("Dia inteiro");
    expect(items[1]).toHaveTextContent("Audiência");
    expect(items[1]).toHaveTextContent("Atualizada agora");
    expect(field()).toHaveValue("");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["tasks"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["briefing"] });
    // a linha do Painel (id t1) ganha a marca; fora do diálogo
    const row = screen.getByText("Recurso", { selector: "li > div > span" }).closest("li")!;
    expect(row).toHaveTextContent("Atualizada agora");
  });

  it("log é uma região aria-live", () => {
    setup();
    openWithButton();
    expect(screen.getByRole("log")).toHaveAttribute("aria-live", "polite");
  });

  it("Enter envia; Shift+Enter não", async () => {
    api.sendAssistantMessage.mockResolvedValue({ reply: "ok", affectedTasks: [] });
    setup();
    openWithButton();
    type("oi");
    fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });
    expect(api.sendAssistantMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "Enter" });
    await waitFor(() => expect(api.sendAssistantMessage).toHaveBeenCalledTimes(1));
  });

  it("dois Enter rápidos fazem uma só chamada e o botão fica desabilitado", async () => {
    let resolve!: (v: unknown) => void;
    api.sendAssistantMessage.mockReturnValue(new Promise((r) => (resolve = r)));
    setup();
    openWithButton();
    type("oi");
    fireEvent.keyDown(field(), { key: "Enter" });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(api.sendAssistantMessage).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(sendBtn()).toBeDisabled());
    await act(async () => resolve({ reply: "ok", affectedTasks: [] }));
    await waitFor(() => expect(sendBtn()).toBeDisabled()); // texto vazio após sucesso
    expect(api.sendAssistantMessage).toHaveBeenCalledTimes(1);
  });

  it("resposta parcial é mostrada como qualquer resposta", async () => {
    api.sendAssistantMessage.mockResolvedValue({
      reply: "Só consegui criar 1 de 2. Envie de novo só o que faltou.",
      affectedTasks: [affected],
    });
    setup();
    openWithButton();
    type("duas coisas");
    fireEvent.click(sendBtn());
    expect(await screen.findByText("Só consegui criar 1 de 2. Envie de novo só o que faltou.")).toBeInTheDocument();
  });

  it.each([
    [
      "429",
      new ApiError(429, "limite_de_mensagens", { error: "limite_de_mensagens", retryAfterSeconds: 90 }),
      "Limite de 30 mensagens por hora atingido. Tente de novo em 2 min.",
    ],
    [
      "503 configuracao",
      new ApiError(503, "assistente_indisponivel", { error: "assistente_indisponivel", reason: "configuracao" }),
      "O assistente ainda não está configurado.",
    ],
    [
      "503 outro",
      new ApiError(503, "assistente_indisponivel", { error: "assistente_indisponivel", reason: "timeout" }),
      "O assistente está indisponível agora. Nada foi alterado.",
    ],
    [
      "409 em_processamento",
      new ApiError(409, "em_processamento", { error: "em_processamento" }),
      "Sua mensagem anterior ainda está sendo processada. Aguarde um instante e tente de novo.",
    ],
    [
      "409 conflito",
      new ApiError(409, "conflito_de_evento", { error: "conflito_de_evento" }),
      "Não foi possível processar esta mensagem. Tente reenviar.",
    ],
    ["rede", new ApiError(0, "rede", null), "Sem conexão com o servidor."],
  ])("erro %s mostra a mensagem exata e mantém o texto", async (_n, error, message) => {
    api.sendAssistantMessage.mockRejectedValue(error);
    setup();
    openWithButton();
    type("Preciso disso");
    fireEvent.click(sendBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(field()).toHaveValue("Preciso disso");
    expect(sendBtn()).toBeEnabled();
  });

  it("reenvio após erro usa o mesmo id; após sucesso, id novo", async () => {
    api.sendAssistantMessage
      .mockRejectedValueOnce(new ApiError(0, "rede", null))
      .mockResolvedValue({ reply: "ok", affectedTasks: [] });
    setup();
    openWithButton();
    type("mesma");
    fireEvent.click(sendBtn());
    await screen.findByRole("alert");
    fireEvent.click(sendBtn());
    await waitFor(() => expect(field()).toHaveValue(""));
    expect(screen.queryByRole("alert")).toBeNull();
    type("mesma");
    fireEvent.click(sendBtn());
    await waitFor(() => expect(api.sendAssistantMessage).toHaveBeenCalledTimes(3));
    const ids = api.sendAssistantMessage.mock.calls.map((c) => c[0].clientMessageId);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("a conversa da sessão permanece ao fechar e reabrir", async () => {
    api.sendAssistantMessage.mockResolvedValue({ reply: "Resposta um", affectedTasks: [] });
    setup();
    openWithButton();
    type("pergunta um");
    fireEvent.click(sendBtn());
    await screen.findByText("Resposta um");
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(dialog()).toBeNull();
    openWithButton();
    expect(screen.getByText("pergunta um")).toBeInTheDocument();
    expect(screen.getByText("Resposta um")).toBeInTheDocument();
  });
});

import { cleanup } from "@testing-library/react";
function cleanupAll() {
  cleanup();
}
