import type { Lancamento, LancamentoSituacao, LancamentoTipo } from "./finance";
import { MAX_CENTAVOS } from "./finance";

/**
 * Lançamentos que a versão anterior do Mini App guardava só neste navegador. Hoje os dados vivem
 * na API; este módulo existe apenas para oferecer a importação única desses lançamentos.
 */
const PREFIX = "nexus:financas:v1:";

const TIPOS: readonly LancamentoTipo[] = ["gasto", "conta", "entrada"];
const SITUACOES: readonly LancamentoSituacao[] = ["paga", "a_pagar"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aceita só o que a API também aceitaria: dado corrompido ou fora do formato é ignorado. */
export function isLancamento(v: unknown): v is Lancamento {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    UUID.test(o.id) &&
    TIPOS.includes(o.tipo as LancamentoTipo) &&
    typeof o.descricao === "string" &&
    o.descricao.trim().length >= 1 &&
    o.descricao.length <= 120 &&
    typeof o.valorCentavos === "number" &&
    Number.isInteger(o.valorCentavos) &&
    o.valorCentavos > 0 &&
    o.valorCentavos <= MAX_CENTAVOS &&
    (o.categoria === null || (typeof o.categoria === "string" && o.categoria.length >= 1 && o.categoria.length <= 40)) &&
    typeof o.data === "string" &&
    ISO.test(o.data) &&
    SITUACOES.includes(o.situacao as LancamentoSituacao) &&
    (o.tipo !== "gasto" || o.situacao === "paga") &&
    (o.lembreteHora === null || (typeof o.lembreteHora === "string" && HORA.test(o.lembreteHora))) &&
    typeof o.criadoEm === "string"
  );
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readLocalLancamentos(userId: string): Lancamento[] {
  try {
    const raw = storage()?.getItem(`${PREFIX}${userId}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isLancamento) : [];
  } catch {
    return [];
  }
}

export function clearLocalLancamentos(userId: string): void {
  try {
    storage()?.removeItem(`${PREFIX}${userId}`);
  } catch {
    // Armazenamento bloqueado: nada a limpar.
  }
}
