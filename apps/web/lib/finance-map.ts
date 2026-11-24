import type { CreateFinanceEntryInput, FinanceEntryDto } from "@nexus/shared";
import type { Lancamento } from "./finance";

/** DTO da API (inglês, vindo do contrato compartilhado) → modelo das telas. */
export function toLancamento(dto: FinanceEntryDto): Lancamento {
  return {
    id: dto.id,
    tipo: dto.kind,
    descricao: dto.description,
    valorCentavos: dto.amountCents,
    categoria: dto.category,
    data: dto.dueDate,
    situacao: dto.status,
    lembreteHora: dto.reminderTime,
    criadoEm: dto.createdAt,
  };
}

/** Modelo das telas → corpo do POST. O id é do cliente: permite criar e desfazer sem esperar a rede. */
export function toCreateInput(item: Lancamento): CreateFinanceEntryInput {
  return {
    id: item.id,
    kind: item.tipo,
    description: item.descricao,
    amountCents: item.valorCentavos,
    category: item.categoria,
    dueDate: item.data,
    status: item.situacao,
    reminderTime: item.lembreteHora,
  };
}

/** Mais antigos primeiro, como o usuário os anotou; o id desempata para a ordem ser estável. */
export function byCreation(first: Lancamento, second: Lancamento): number {
  if (first.criadoEm !== second.criadoEm) return first.criadoEm < second.criadoEm ? -1 : 1;
  return first.id < second.id ? -1 : 1;
}
