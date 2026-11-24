const HOME_PATH = "/";

/**
 * Aceita apenas caminho interno ("/x"); qualquer outra coisa volta para "/". Evita redirecionamento aberto
 * depois do login: "//site.com" e "/\site.com" são lidos pelo navegador como outro domínio.
 */
export function safeNext(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw === "") return HOME_PATH;
  if (!raw.startsWith("/") || raw.startsWith("//")) return HOME_PATH;
  if (raw.includes("\\")) return HOME_PATH;
  // Caracteres de controle (ex.: tab, quebra de linha) são descartados pelo navegador e podem esconder um "//".
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return HOME_PATH;
  return raw;
}
