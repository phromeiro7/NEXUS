/** Limite de leitura do User-Agent: o cabeçalho vem do cliente e pode ser enorme; só o começo importa. */
const MAX_USER_AGENT_LENGTH = 512;

/** Sistemas operacionais na ordem de teste: o primeiro padrão que casa vence. */
const OPERATING_SYSTEM_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/iPhone|iPad|iPod/i, 'iOS'],
  [/Android/i, 'Android'],
  [/Windows/i, 'Windows'],
  [/CrOS/i, 'ChromeOS'],
  [/Mac OS X|Macintosh/i, 'macOS'],
  [/Linux|X11/i, 'Linux'],
];

/** Ordem importa: Edge, Opera e o Chrome do iOS também dizem "Chrome"/"Safari". */
const BROWSER_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

function findFirstMatch(text: string, patterns: ReadonlyArray<readonly [RegExp, string]>): string | null {
  return patterns.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/**
 * Descrição curta do navegador de quem pediu o login ("Chrome em macOS"), só para a pergunta do bot: quem
 * confirma vê de onde veio o pedido. Lida do cabeçalho User-Agent, que é informado pelo próprio cliente
 * (serve para a pessoa reconhecer o pedido, nunca como prova de nada). Sem informação útil: "Navegador".
 */
export function describeBrowser(userAgent: string | undefined): string {
  const userAgentText = (userAgent ?? '').slice(0, MAX_USER_AGENT_LENGTH);
  const operatingSystem = findFirstMatch(userAgentText, OPERATING_SYSTEM_PATTERNS);
  const browser = findFirstMatch(userAgentText, BROWSER_PATTERNS);
  if (browser !== null && operatingSystem !== null) return `${browser} em ${operatingSystem}`;
  if (browser !== null) return browser;
  if (operatingSystem !== null) return `Navegador em ${operatingSystem}`;
  return 'Navegador';
}
