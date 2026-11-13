"use client";

import type { IsoDate } from "@aj/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import { dueLabel, formatBRL, isOverdue, tipoLabel, type Lancamento } from "@/lib/finance";
import { CheckIcon, ChevronIcon, ClockIcon, TrashIcon } from "./icons";

/** Conta a pagar (ou entrada a receber) na mesma linha visual de uma tarefa, com o valor ao lado. */
export function BillItem({
  bill,
  today,
  onPay,
  onDelete,
  index = 0,
}: {
  bill: Lancamento;
  today: IsoDate;
  onPay: (bill: Lancamento) => void;
  /** Sem `onDelete` (tela Hoje), a linha não abre a edição nem mostra Excluir. */
  onDelete?: (bill: Lancamento) => void;
  index?: number;
}) {
  const late = isOverdue(bill, today);
  const incoming = bill.tipo === "entrada";
  return (
    <li className={`mini-item${late ? " late" : ""}`} style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}>
      <button
        type="button"
        className="mini-check"
        aria-label={`Marcar ${bill.descricao} como ${incoming ? "recebida" : "paga"}`}
        onClick={() => onPay(bill)}
      >
        <span>
          <CheckIcon />
        </span>
      </button>
      <Body href={onDelete ? `/mini/financas/${bill.id}` : null} label={`Editar ${bill.descricao}`}>
        <div>
          <strong>{bill.descricao}</strong>
          <span className="mini-meta">
            {late ? (
              <span className="late-text">
                <ClockIcon />
                {dueLabel(bill, today)}
              </span>
            ) : (
              <span>{incoming ? dueLabel(bill, today).replace("Vence", "Chega").replace("Venceu", "Chegava") : dueLabel(bill, today)}</span>
            )}
          </span>
        </div>
        <span className={`mini-amount${incoming ? " in" : ""}`}>{formatBRL(bill.valorCentavos)}</span>
        {onDelete && <ChevronIcon />}
      </Body>
      {onDelete && (
        <button type="button" className="mini-reopen" aria-label={`Excluir ${bill.descricao}`} onClick={() => onDelete(bill)}>
          <TrashIcon />
          <span>Excluir</span>
        </button>
      )}
    </li>
  );
}

function Body({ href, label, children }: { href: string | null; label: string; children: ReactNode }) {
  return href === null ? (
    <div className="mini-body">{children}</div>
  ) : (
    <Link href={href} className="mini-body" aria-label={label}>
      {children}
    </Link>
  );
}

/** Lançamento já pago ou recebido: toque para editar, com Excluir ao lado (a lista de contas só tem o que falta pagar). */
export function PaidItem({
  entry,
  onDelete,
  index = 0,
}: {
  entry: Lancamento;
  onDelete: (entry: Lancamento) => void;
  index?: number;
}) {
  const incoming = entry.tipo === "entrada";
  return (
    <li className="mini-item done" style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}>
      <span className="mini-done-mark" aria-hidden="true">
        <span>
          <CheckIcon />
        </span>
      </span>
      <Link href={`/mini/financas/${entry.id}`} className="mini-body" aria-label={`Editar ${entry.descricao}`}>
        <div>
          <strong>{entry.descricao}</strong>
          <span className="mini-meta">
            <span>{entry.categoria ? `${tipoLabel(entry)} · ${entry.categoria}` : tipoLabel(entry)}</span>
          </span>
        </div>
        <span className={`mini-amount${incoming ? " in" : ""}`} style={{ paddingRight: 0 }}>
          {incoming ? "+ " : "− "}
          {formatBRL(entry.valorCentavos)}
        </span>
        <ChevronIcon />
      </Link>
      <button type="button" className="mini-reopen" aria-label={`Excluir ${entry.descricao}`} onClick={() => onDelete(entry)}>
        <TrashIcon />
        <span>Excluir</span>
      </button>
    </li>
  );
}
