import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isOptedOut, markHandled, optOut, readInitData, wasHandled } from "./telegram-init";

const DATA = "auth_date=1&user=%7B%22id%22%3A1%7D&hash=abc";

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/mini");
});
afterEach(() => {
  delete window.Telegram;
});

describe("readInitData", () => {
  it("fora do Telegram não há initData", () => {
    expect(readInitData()).toBeNull();
  });

  it("lê o fragmento do Telegram e o guarda para as próximas telas", () => {
    window.history.replaceState(null, "", `/mini#tgWebAppData=${encodeURIComponent(DATA)}&tgWebAppVersion=8.0`);
    expect(readInitData()).toBe(DATA);
    // A navegação interna perde o fragmento; o valor continua disponível.
    window.history.replaceState(null, "", "/mini/financas");
    expect(readInitData()).toBe(DATA);
  });

  it("um uso novo (outro fragmento) vale mais que o guardado", () => {
    window.sessionStorage.setItem("nexus.tg.initData", "velho");
    window.history.replaceState(null, "", `/mini#tgWebAppData=${encodeURIComponent(DATA)}`);
    expect(readInitData()).toBe(DATA);
  });

  it("usa o SDK quando não há fragmento, mas ignora o SDK fora do Telegram", () => {
    window.Telegram = { WebApp: { platform: "ios", initData: DATA } } as never;
    expect(readInitData()).toBe(DATA);
    window.Telegram = { WebApp: { platform: "unknown", initData: "" } } as never;
    expect(readInitData()).toBeNull();
  });
});

describe("marcas de uso", () => {
  it("lembra o initData já tratado e a saída, só para aquele initData", () => {
    expect(wasHandled(DATA)).toBe(false);
    markHandled(DATA);
    expect(wasHandled(DATA)).toBe(true);
    expect(wasHandled("outro")).toBe(false);

    expect(isOptedOut(DATA)).toBe(false);
    optOut(DATA);
    expect(isOptedOut(DATA)).toBe(true);
    // Um uso novo do app (outro initData) volta a entrar sozinho.
    expect(isOptedOut("novo")).toBe(false);
  });
});
