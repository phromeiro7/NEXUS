"use client";

import type { IsoDate } from "@nexus/shared";
import { dueLabel, formatBRL, isOverdue, type Lancamento } from "@/lib/finance";
import { CheckIcon, ClockIcon } from "./icons";

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
      <div className="mini-body">
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
      </div>
    </li>
  );
}
