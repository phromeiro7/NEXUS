"use client";

import type { IsoDate } from "@nexus/shared";
import { dueLabel, formatBRL, isOverdue, type Lancamento } from "@/lib/finance";
import { CheckIcon, ClockIcon } from "./icons";

/** Animação de entrada escalonada: cada linha atrasa um pouco mais, até um teto para listas longas. */
const STAGGER_STEP_MS = 30;
const MAX_STAGGERED_ITEMS = 8;

/** Conta a pagar (ou entrada a receber) na mesma linha visual de uma tarefa, com o valor ao lado. */
export function BillItem({
  bill,
  today,
  onPay,
  index = 0,
}: {
  bill: Lancamento;
  today: IsoDate;
  onPay: (bill: Lancamento) => void;
  index?: number;
}) {
  const isLate = isOverdue(bill, today);
  const isIncoming = bill.tipo === "entrada";
  // Para entradas o rótulo de vencimento fala em "chegar" em vez de "vencer".
  const dueText = isIncoming
    ? dueLabel(bill, today).replace("Vence", "Chega").replace("Venceu", "Chegava")
    : dueLabel(bill, today);
  return (
    <li className={`mini-item${isLate ? " late" : ""}`}
      style={{ animationDelay: `${Math.min(index, MAX_STAGGERED_ITEMS) * STAGGER_STEP_MS}ms` }}>
      <button
        type="button"
        className="mini-check"
        aria-label={`Marcar ${bill.descricao} como ${isIncoming ? "recebida" : "paga"}`}
        onClick={() => onPay(bill)}
      >
        <span>
          <CheckIcon />
        </span>
      </button>
      <div className="mini-body">
        <div>
          <strong>{bill.descricao}</strong>
          <span className="mini-meta">
            {isLate ? (
              <span className="late-text">
                <ClockIcon />
                {dueLabel(bill, today)}
              </span>
            ) : (
              <span>{dueText}</span>
            )}
          </span>
        </div>
        <span className={`mini-amount${isIncoming ? " in" : ""}`}>{formatBRL(bill.valorCentavos)}</span>
      </div>
    </li>
  );
}
