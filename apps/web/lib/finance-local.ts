import type { Lancamento, LancamentoSituacao, LancamentoTipo } from "./finance";
import { MAX_CENTAVOS } from "./finance";

/**
 * Lançamentos que a versão anterior do Mini App guardava só neste navegador. Hoje os dados vivem
 * na API; este módulo existe apenas para oferecer a importação única desses lançamentos.
 */
/** Prefixo da chave no localStorage; a chave completa termina com o id do usuário. */
const STORAGE_KEY_PREFIX = "nexus:financas:v1:";

const VALID_TIPOS: readonly LancamentoTipo[] = ["gasto", "conta", "entrada"];
const VALID_SITUACOES: readonly LancamentoSituacao[] = ["paga", "a_pagar"];
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Limites de tamanho iguais aos da API. */
const MAX_DESCRIPTION_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 40;

/** Aceita só o que a API também aceitaria: dado corrompido ou fora do formato é ignorado. */
export function isLancamento(value: unknown): value is Lancamento {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    UUID_PATTERN.test(candidate.id) &&
    VALID_TIPOS.includes(candidate.tipo as LancamentoTipo) &&
    typeof candidate.descricao === "string" &&
    candidate.descricao.trim().length >= 1 &&
    candidate.descricao.length <= MAX_DESCRIPTION_LENGTH &&
    // Dinheiro em centavos inteiros e positivos.
    typeof candidate.valorCentavos === "number" &&
    Number.isInteger(candidate.valorCentavos) &&
    candidate.valorCentavos > 0 &&
    candidate.valorCentavos <= MAX_CENTAVOS &&
    (candidate.categoria === null ||
      (typeof candidate.categoria === "string" &&
        candidate.categoria.length >= 1 &&
        candidate.categoria.length <= MAX_CATEGORY_LENGTH)) &&
    typeof candidate.data === "string" &&
    ISO_DATE_PATTERN.test(candidate.data) &&
    VALID_SITUACOES.includes(candidate.situacao as LancamentoSituacao) &&
    // Gasto é sempre algo que já foi pago.
    (candidate.tipo !== "gasto" || candidate.situacao === "paga") &&
    (candidate.lembreteHora === null ||
      (typeof candidate.lembreteHora === "string" && TIME_PATTERN.test(candidate.lembreteHora))) &&
    typeof candidate.criadoEm === "string"
  );
}

/** localStorage, ou null quando não existe (servidor) ou o navegador o bloqueia (o acesso lança erro). */
function localStorageOrNull(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Lançamentos válidos guardados neste navegador para o usuário; vazio diante de qualquer problema. */
export function readLocalLancamentos(userId: string): Lancamento[] {
  try {
    const raw = localStorageOrNull()?.getItem(`${STORAGE_KEY_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isLancamento) : [];
  } catch {
    return [];
  }
}

/** Apaga os lançamentos locais do usuário (depois de importados ou descartados). */
export function clearLocalLancamentos(userId: string): void {
  try {
    localStorageOrNull()?.removeItem(`${STORAGE_KEY_PREFIX}${userId}`);
  } catch {
    // Armazenamento bloqueado: nada a limpar.
  }
}
