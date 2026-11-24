/**
 * O `initData` do Telegram Mini App e o que o app lembra sobre ele durante este uso (sessionStorage:
 * some ao fechar o app). Nunca é registrado nem exibido. O Telegram o entrega no fragmento da URL
 * (`#tgWebAppData=...`), que a navegação interna do Next descarta; por isso o guardamos no primeiro acesso.
 */
const INIT_DATA_KEY = "nexus.tg.initData";
const HANDLED_KEY = "nexus.tg.handled";
const OPT_OUT_KEY = "nexus.tg.optout";
/** Parâmetro do fragmento da URL em que o Telegram entrega o initData. */
const INIT_DATA_HASH_PARAM = "tgWebAppData";
/** Valor de `platform` quando o SDK do Telegram carrega num navegador comum, fora do Telegram. */
export const OUTSIDE_TELEGRAM_PLATFORM = "unknown";

/** sessionStorage, ou null no servidor ou quando o navegador o bloqueia. */
function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** O initData deste uso do app, ou null fora do Telegram (navegador comum). */
export function readInitData(): string | null {
  if (typeof window === "undefined") return null;
  const storage = sessionStorageOrNull();
  let fromHash: string | null = null;
  try {
    fromHash = new URLSearchParams(window.location.hash.replace(/^#/, "")).get(INIT_DATA_HASH_PARAM);
  } catch {
    fromHash = null;
  }
  if (fromHash) {
    try {
      storage?.setItem(INIT_DATA_KEY, fromHash);
    } catch {
      // sem sessionStorage: vale só nesta página
    }
    return fromHash;
  }
  try {
    const kept = storage?.getItem(INIT_DATA_KEY);
    if (kept) return kept;
  } catch {
    // ignorado
  }
  // Último recurso: o SDK do Telegram. Fora do Telegram ele carrega, mas com plataforma "unknown".
  const sdk = window.Telegram?.WebApp;
  return sdk && sdk.platform !== "unknown" && sdk.initData ? sdk.initData : null;
}

function readSessionValue(key: string): string | null {
  try {
    return sessionStorageOrNull()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function writeSessionValue(key: string, value: string): void {
  try {
    sessionStorageOrNull()?.setItem(key, value);
  } catch {
    // ignorado
  }
}

/** Esse initData já foi trocado por sessão (ou recusado como já usado): não tentar de novo. */
export const wasHandled = (initData: string): boolean => readSessionValue(HANDLED_KEY) === initData;
export const markHandled = (initData: string): void => writeSessionValue(HANDLED_KEY, initData);

/**
 * A pessoa saiu da conta dentro do Telegram: não entrar sozinho de novo com ESTE initData. Um uso novo do
 * app traz outro initData e volta a entrar sozinho.
 */
export const isOptedOut = (initData: string): boolean => readSessionValue(OPT_OUT_KEY) === initData;
export const optOut = (initData: string): void => writeSessionValue(OPT_OUT_KEY, initData);
