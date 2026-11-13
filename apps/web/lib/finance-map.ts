import type { CreateFinanceEntryInput, FinanceEntryDto, UpdateFinanceEntryInput } from "@aj/shared";
import type { Lancamento, LancamentoPatch } from "./finance";

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

/** Mudanças do modelo das telas → corpo do PATCH (só os campos presentes). */
export function toUpdateInput(patch: LancamentoPatch): UpdateFinanceEntryInput {
  return {
    ...(patch.descricao !== undefined ? { description: patch.descricao } : {}),
    ...(patch.valorCentavos !== undefined ? { amountCents: patch.valorCentavos } : {}),
    ...(patch.categoria !== undefined ? { category: patch.categoria } : {}),
    ...(patch.data !== undefined ? { dueDate: patch.data } : {}),
    ...(patch.lembreteHora !== undefined ? { reminderTime: patch.lembreteHora } : {}),
  };
}

/** Mais antigos primeiro, como o usuário os anotou; o id desempata para a ordem ser estável. */
export function byCreation(a: Lancamento, b: Lancamento): number {
  return a.criadoEm < b.criadoEm ? -1 : a.criadoEm > b.criadoEm ? 1 : a.id < b.id ? -1 : 1;
}
