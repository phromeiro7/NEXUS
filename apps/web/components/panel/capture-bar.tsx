"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CaptureProposalDto, IsoDate } from "@nexus/shared";
import { useApi } from "@/components/auth-provider";
import { PlusIcon } from "@/components/mini/icons";
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

const EXAMPLE_PHRASES = ["Pagar a conta de internet amanhã às 10h", "Reunião com a equipe sexta 9h30", "Gastei 45 no mercado"];
/** Limite de caracteres da frase digitada na barra. */
const CAPTURE_MAX_LENGTH = 500;
const NOT_UNDERSTOOD_HINT = "Tente: gastei 45 no mercado · recebi 800 de um serviço · reunião com a equipe sexta 9h30";

/** Proposta aberta para confirmação, com o "hoje" da API (no fuso da conta) usado para interpretá-la. */
type OpenProposal = { proposal: CaptureProposalDto; today: IsoDate };

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
  const inputRef = useRef<HTMLInputElement>(null);
  // Trava síncrona: evita duas interpretações simultâneas (Enter repetido, clique em exemplo durante a espera).
  const interpretingRef = useRef(false);
  const [text, setText] = useState("");
  const [openProposal, setOpenProposal] = useState<OpenProposal | null>(null);
  const [editing, setEditing] = useState(false);
  const [notUnderstood, setNotUnderstood] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [understanding, setUnderstanding] = useState(false);
  // Conta as propostas abertas: muda a cada nova, mesmo que o conteúdo seja igual, e dispara o foco abaixo.
  const [proposalSequence, setProposalSequence] = useState(0);
  const actionsRef = useRef<HTMLDivElement>(null);

  // O atalho "/" do painel foca este campo.
  useEffect(() => registerCapture(() => inputRef.current?.focus()), [registerCapture]);

  // Quando uma proposta nova abre, o foco vai para a primeira ação possível (Confirmar; Editar se ainda falta o dia).
  useEffect(() => {
    if (proposalSequence > 0) actionsRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [proposalSequence]);

  function reset() {
    setText("");
    setOpenProposal(null);
    setEditing(false);
    setNotUnderstood(false);
    setError(null);
  }

  async function interpret(value: string) {
    if (interpretingRef.current || value.trim() === "") return;
    interpretingRef.current = true;
    setUnderstanding(true);
    setError(null);
    setNotUnderstood(false);
    setEditing(false);
    try {
      const result = await api.interpretCapture({ text: value.trim() });
      if (result.proposal === null) {
        setOpenProposal(null);
        setNotUnderstood(true);
      } else {
        setOpenProposal({ proposal: result.proposal, today: result.today });
        setProposalSequence((sequence) => sequence + 1);
      }
    } catch (caughtError) {
      setOpenProposal(null);
      setError(messageFor(caughtError));
    } finally {
      interpretingRef.current = false;
      setUnderstanding(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isEmpty) {
      inputRef.current?.focus();
      return;
    }
    void interpret(text);
  }

  async function confirmProposal() {
    if (openProposal === null || saving) return;
    const creation = toCreation(openProposal.proposal, openProposal.today);
    if (creation === null) return;
    const summary = proposalSummary(openProposal.proposal, openProposal.today);
    setSaving(true);
    setError(null);
    try {
      if (creation.kind === "tarefa") {
        const task = await createTask.mutateAsync(creation.input);
        toast({ message: `Anotado: ${summary}.`, undo: () => void removeTask.mutateAsync(task.id) });
      } else {
        // Lançamentos financeiros ficam no aparelho (useFinance); `add` devolve null se o valor for inválido.
        const created = finance.add(creation.input);
        if (created === null) {
          setError("Não foi possível anotar. Confira o valor e tente de novo.");
          return;
        }
        toast({ message: `Anotado: ${summary}.`, undo: () => finance.remove(created.id) });
      }
      reset();
      inputRef.current?.focus();
    } catch (caughtError) {
      setError(messageFor(caughtError));
    } finally {
      setSaving(false);
    }
  }

  const proposal = openProposal?.proposal ?? null;
  const note = proposal === null ? null : proposalNote(proposal);
  const isEmpty = text.trim() === "";
  const showExamples = isEmpty && openProposal === null && !notUnderstood && !understanding;

  return (
    <div className="pn-head">
      <div className="pn-capture-block">
        <div className="pn-capture-top">
          <label htmlFor="pn-capture" className="pn-capture-label">
            Nova tarefa ou lançamento
          </label>
          <button type="button" className="pn-link-btn" aria-expanded={helpOpen} aria-controls="pn-help" onClick={toggleHelp}>
            Atalhos <kbd className="pn-kbd">?</kbd>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="pn-capture" role="search" aria-label="Anotar">
          <div className="pn-capture-field">
            <span className="pn-capture-plus" aria-hidden="true">
              <PlusIcon />
            </span>
            <input
              ref={inputRef}
              id="pn-capture"
              className="mini-field pn-capture-input"
              value={text}
              maxLength={CAPTURE_MAX_LENGTH}
              autoComplete="off"
              placeholder="Escreva uma tarefa ou um gasto"
              aria-describedby="pn-capture-hint"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") reset();
              }}
            />
            <kbd className="pn-kbd" aria-hidden="true">
              /
            </kbd>
          </div>
          <button type="submit" className="mini-btn primary pn-capture-btn" disabled={understanding}>
            {understanding ? "Entendendo…" : "Adicionar"}
          </button>
        </form>
        <p id="pn-capture-hint" className="pn-capture-hint">
          Enter também adiciona. Nada é salvo antes de você confirmar.
        </p>
      </div>

      {showExamples && (
        <div className="pn-examples">
          <span className="pn-sub">Exemplos:</span>
          {EXAMPLE_PHRASES.map((example) => (
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
      )}

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

      <div role="status" aria-live="polite" className="pn-live">
        {understanding && <p className="pn-sub">Entendendo o que você escreveu…</p>}
        {notUnderstood && (
          <p>
            <strong>Não entendi.</strong> <span className="pn-sub">{NOT_UNDERSTOOD_HINT}</span>
          </p>
        )}
        {openProposal !== null && proposal !== null && (
          <p className="pn-proposal-text">
            <strong>Anotei:</strong> {proposalSummary(proposal, openProposal.today)}
          </p>
        )}
      </div>
      {error !== null && (
        <p role="alert" className="mini-fielderr" style={{ margin: 0 }}>
          {error}
        </p>
      )}

      {openProposal !== null && proposal !== null && (
        <section role="group" aria-label="Proposta" className="pn-proposal">
          {note !== null && <p className="pn-sub">{note}</p>}
          <div className="pn-dialog-actions" ref={actionsRef}>
            <button type="button" className="mini-btn primary pn-small-btn" disabled={!canConfirm(proposal) || saving} onClick={() => void confirmProposal()}>
              {saving ? "Anotando…" : "Confirmar"}
            </button>
            <button type="button" className="mini-btn pn-small-btn" aria-expanded={editing} onClick={() => setEditing((isEditing) => !isEditing)}>
              Editar
            </button>
            <button type="button" className="mini-btn pn-small-btn" onClick={reset}>
              Descartar
            </button>
          </div>
          {editing && (
            <EditChips
              openProposal={openProposal}
              onChange={(nextProposal) => setOpenProposal({ ...openProposal, proposal: nextProposal })}
            />
          )}
        </section>
      )}
    </div>
  );
}

/** Ajustes rápidos da proposta antes de confirmar: categoria (só lançamentos), dia e horário. */
function EditChips({ openProposal, onChange }: { openProposal: OpenProposal; onChange: (proposal: CaptureProposalDto) => void }) {
  const { proposal, today } = openProposal;
  const categories = categoryOptions(proposal);
  const selectedCategory = proposal.kind === "tarefa" ? null : proposal.category;
  const days = dayOptions(proposal, today);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {categories.length > 0 && (
        <div role="group" aria-label="Categoria" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <strong style={{ fontSize: "0.9375rem" }}>Categoria</strong>
          <div className="mini-chips">
            {categories.map((category) => (
              <button key={category} type="button" className="mini-chip" aria-pressed={selectedCategory === category} onClick={() => onChange(withCategory(proposal, category))}>
                {category}
              </button>
            ))}
          </div>
        </div>
      )}
      <div role="group" aria-label={proposal.kind === "conta" ? "Vencimento" : "Dia"} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: "0.9375rem" }}>{proposal.kind === "conta" ? "Vencimento" : "Dia"}</strong>
        <div className="mini-chips">
          {days.map((dayOption) => (
            <button key={dayOption.label} type="button" className="mini-chip" aria-pressed={proposal.date === dayOption.date} onClick={() => onChange(withDay(proposal, dayOption.date))}>
              {dayOption.label}
            </button>
          ))}
        </div>
      </div>
      {proposal.date !== null && (
        <div role="group" aria-label="Horário" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <strong style={{ fontSize: "0.9375rem" }}>Horário</strong>
          <div className="mini-chips">
            {timeOptions().map((timeOption) => (
              <button key={timeOption.label} type="button" className="mini-chip" aria-pressed={proposal.time === timeOption.time} onClick={() => onChange(withTime(proposal, timeOption.time))}>
                {timeOption.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
