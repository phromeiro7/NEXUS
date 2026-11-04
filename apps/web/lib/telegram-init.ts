/**
 * O `initData` do Telegram Mini App e o que o app lembra sobre ele durante este uso (sessionStorage:
 * some ao fechar o app). Nunca é registrado nem exibido. O Telegram o entrega no fragmento da URL
 * (`#tgWebAppData=...`), que a navegação interna do Next descarta; por isso o guardamos no primeiro acesso.
 */
const DATA = "nexus.tg.initData";
const HANDLED = "nexus.tg.handled";
const OPT_OUT = "nexus.tg.optout";

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** O initData deste uso do app, ou null fora do Telegram (navegador comum). */
export function readInitData(): string | null {
  if (typeof window === "undefined") return null;
  const s = store();
  let fromHash: string | null = null;
  try {
    fromHash = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("tgWebAppData");
  } catch {
    fromHash = null;
  }
  if (fromHash) {
    try {
      s?.setItem(DATA, fromHash);
    } catch {
      // sem sessionStorage: vale só nesta página
    }
    return fromHash;
  }
  try {
    const kept = s?.getItem(DATA);
    if (kept) return kept;
  } catch {
    // ignorado
  }
  const sdk = window.Telegram?.WebApp;
  return sdk && sdk.platform !== "unknown" && sdk.initData ? sdk.initData : null;
}

function get(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function set(key: string, value: string): void {
  try {
    store()?.setItem(key, value);
  } catch {
    // ignorado
  }
}

/** Esse initData já foi trocado por sessão (ou recusado como já usado): não tentar de novo. */
export const wasHandled = (initData: string): boolean => get(HANDLED) === initData;
export const markHandled = (initData: string): void => set(HANDLED, initData);

/**
 * A pessoa saiu da conta dentro do Telegram: não entrar sozinho de novo com ESTE initData. Um uso novo do
 * app traz outro initData e volta a entrar sozinho.
 */
export const isOptedOut = (initData: string): boolean => get(OPT_OUT) === initData;
export const optOut = (initData: string): void => set(OPT_OUT, initData);
