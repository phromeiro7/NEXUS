"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CaptureProposalDto, IsoDate } from "@aj/shared";
import { useApi } from "@/components/auth-provider";
import { useToast } from "@/components/mini/toast";
import { useFinance } from "@/hooks/finance";
import { useCreateTask, useDeleteTask } from "@/hooks/queries";
import {
  canConfirm,
  categoryOptions,
  dayOptions,
  proposalNote,
  proposalSummary,
  timeOptions,
  toCreation,
  withCategory,
  withDay,
  withTime,
} from "@/lib/capture-proposal";
import { messageFor } from "@/lib/messages";
import { useShortcuts } from "./shortcuts";

const EXAMPLES = ["gastei 100 em roupa", "ligar pra vidinha hoje 14h", "luz 187,40 vence dia 8"];
const HELP_TEXT = "Tente: gastei 42 no almoço · ligar pra Ana amanhã 14h · luz 187,40 vence dia 8";

type Open = { proposal: CaptureProposalDto; today: IsoDate };

/**
 * Barra de captura do painel (Hoje e Finanças). A frase vai para a API, que a lê com as mesmas regras do bot;
 * aqui aparece a proposta e NADA é gravado antes de "Confirmar". Quando as regras não entendem, mostra exemplos.
 */
export function CaptureBar() {
  const api = useApi();
  const finance = useFinance();
  const createTask = useCreateTask();
  const removeTask = useDeleteTask();
  const toast = useToast();
  const { registerCapture, helpOpen, toggleHelp } = useShortcuts();
  const field = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [text, setText] = useState("");
  const [open, setOpen] = useState<Open | null>(null);
  const [editing, setEditing] = useState(false);
  const [miss, setMiss] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => registerCapture(() => field.current?.focus()), [registerCapture]);

  function reset() {
    setText("");
    setOpen(null);
    setEditing(false);
    setMiss(false);
    setError(null);
  }

  async function interpret(value: string) {
    if (busy.current || value.trim() === "") return;
    busy.current = true;
    setError(null);
    setMiss(false);
    setEditing(false);
    try {
      const result = await api.interpretCapture({ text: value.trim() });
      if (result.proposal === null) {
        setOpen(null);
        setMiss(true);
      } else {
        setOpen({ proposal: result.proposal, today: result.today });
      }
    } catch (err) {
      setOpen(null);
      setError(messageFor(err));
    } finally {
      busy.current = false;
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void interpret(text);
  }

  async function confirm() {
    if (open === null || saving) return;
    const creation = toCreation(open.proposal, open.today);
    if (creation === null) return;
    const summary = proposalSummary(open.proposal, open.today);
    setSaving(true);
    setError(null);
    try {
      if (creation.kind === "tarefa") {
        const task = await createTask.mutateAsync(creation.input);
        toast({ message: `Anotado: ${summary}.`, undo: () => void removeTask.mutateAsync(task.id) });
      } else {
        const created = finance.add(creation.input);
        if (created === null) {
          setError("Não foi possível anotar. Confira o valor e tente de novo.");
          return;
        }
        toast({ message: `Anotado: ${summary}.`, undo: () => finance.remove(created.id) });
      }
      reset();
      field.current?.focus();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSaving(false);
    }
  }

  const proposal = open?.proposal ?? null;
  const note = proposal === null ? null : proposalNote(proposal);

  return (
    <div className="pn-head">
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <form onSubmit={submit} className="pn-capture" style={{ flex: 1, minWidth: 320 }} role="search" aria-label="Anotar">
          <div className="pn-capture-field">
            <label htmlFor="pn-capture" style={srOnly}>
              Anotar tarefa, gasto ou conta
            </label>
            <input
              ref={field}
              id="pn-capture"
              className="mini-field"
              value={text}
              maxLength={500}
              autoComplete="off"
              placeholder="Anote algo: gastei 100 em roupa, ligar pra vidinha hoje 14h"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") reset();
              }}
            />
            <kbd className="pn-kbd" aria-hidden="true">
              /
            </kbd>
          </div>
          <button type="submit" className="mini-btn primary">
            Anotar
          </button>
        </form>
        <button type="button" className="mini-btn" aria-expanded={helpOpen} aria-controls="pn-help" onClick={toggleHelp}>
          Atalhos <kbd className="pn-kbd">?</kbd>
        </button>
      </div>

      <div className="pn-examples">
        <span className="pn-sub">Experimente:</span>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="mini-chip"
            onClick={() => {
              setText(example);
              void interpret(example);
            }}
          >
            {example}
          </button>
        ))}
      </div>

      {helpOpen && (
        <div id="pn-help" role="region" aria-label="Atalhos de teclado" className="pn-help">
          <div>
            <kbd className="pn-kbd">N</kbd> nova tarefa
          </div>
          <div>
            <kbd className="pn-kbd">/</kbd> anotar ou buscar
          </div>
          <div>
            <kbd className="pn-kbd">Enter</kbd> enviar o que você digitou
          </div>
          <div>
            <kbd className="pn-kbd">Esc</kbd> limpar ou fechar
          </div>
          <div>
            <kbd className="pn-kbd">?</kbd> mostrar ou esconder esta lista
          </div>
        </div>
      )}

      {miss && (
        <p role="status" style={{ margin: 0, maxWidth: 780 }}>
          <strong>Não entendi.</strong> <span className="pn-sub">{HELP_TEXT}</span>
        </p>
      )}
      {error !== null && (
        <p role="alert" className="mini-fielderr" style={{ margin: 0 }}>
          {error}
        </p>
      )}

      {open !== null && proposal !== null && (
        <section role="status" aria-label="Proposta" className="pn-proposal">
          <p style={{ fontSize: "1.0625rem", lineHeight: 1.4 }}>
            <strong>Anotei:</strong> {proposalSummary(proposal, open.today)}
          </p>
          {note !== null && <p className="pn-sub">{note}</p>}
          <div className="pn-dialog-actions">
            <button type="button" className="mini-btn primary pn-small-btn" disabled={!canConfirm(proposal) || saving} onClick={() => void confirm()}>
              {saving ? "Anotando…" : "Confirmar"}
            </button>
            <button type="button" className="mini-btn pn-small-btn" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
              Editar
            </button>
            <button type="button" className="mini-btn pn-small-btn" onClick={reset}>
              Descartar
            </button>
          </div>
          {editing && <EditChips open={open} onChange={(next) => setOpen({ ...open, proposal: next })} />}
        </section>
      )}
    </div>
  );
}

const srOnly = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

function EditChips({ open, onChange }: { open: Open; onChange: (p: CaptureProposalDto) => void }) {
  const { proposal, today } = open;
  const categories = categoryOptions(proposal);
  const category = proposal.kind === "tarefa" ? null : proposal.category;
  const days = dayOptions(proposal, today);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {categories.length > 0 && (
        <div role="group" aria-label="Categoria" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <strong style={{ fontSize: "0.9375rem" }}>Categoria</strong>
          <div className="mini-chips">
            {categories.map((c) => (
              <button key={c} type="button" className="mini-chip" aria-pressed={category === c} onClick={() => onChange(withCategory(proposal, c))}>
                {c}
              </button>
            ))}
          </div>
        </div>
      )}
      <div role="group" aria-label={proposal.kind === "conta" ? "Vencimento" : "Dia"} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: "0.9375rem" }}>{proposal.kind === "conta" ? "Vencimento" : "Dia"}</strong>
        <div className="mini-chips">
          {days.map((d) => (
            <button key={d.label} type="button" className="mini-chip" aria-pressed={proposal.date === d.date} onClick={() => onChange(withDay(proposal, d.date))}>
              {d.label}
            </button>
          ))}
        </div>
      </div>
      {proposal.date !== null && (
        <div role="group" aria-label="Horário" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <strong style={{ fontSize: "0.9375rem" }}>Horário</strong>
          <div className="mini-chips">
            {timeOptions().map((t) => (
              <button key={t.label} type="button" className="mini-chip" aria-pressed={proposal.time === t.time} onClick={() => onChange(withTime(proposal, t.time))}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
