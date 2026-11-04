/**
 * Descrição curta do navegador de quem pediu o login ("Chrome em macOS"), só para a pergunta do bot: quem
 * confirma vê de onde veio o pedido. Lida do cabeçalho User-Agent, que é informado pelo próprio cliente
 * (serve para a pessoa reconhecer o pedido, nunca como prova de nada). Sem informação útil: "Navegador".
 */
export function browserLabel(userAgent: string | undefined): string {
  const ua = (userAgent ?? '').slice(0, 512);
  const os = /iPhone|iPad|iPod/i.test(ua)
    ? 'iOS'
    : /Android/i.test(ua)
      ? 'Android'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /CrOS/i.test(ua)
          ? 'ChromeOS'
          : /Mac OS X|Macintosh/i.test(ua)
            ? 'macOS'
            : /Linux|X11/i.test(ua)
              ? 'Linux'
              : null;
  // Ordem importa: Edge, Opera e o Chrome do iOS também dizem "Chrome"/"Safari".
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  if (browser !== null && os !== null) return `${browser} em ${os}`;
  if (browser !== null) return browser;
  if (os !== null) return `Navegador em ${os}`;
  return 'Navegador';
}
