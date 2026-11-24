/** Minúsculas e sem acentos, para comparar textos: a busca "saude" encontra "Saúde". */
export const normalizeForComparison = (text: string): string => text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
