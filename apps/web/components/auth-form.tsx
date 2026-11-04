"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { EyeIcon, EyeOffIcon, NexusMark } from "./mini/icons";

/** Moldura das telas de acesso: marca Nexus, título, texto de apoio e o cartão do formulário. */
export function AuthCard({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <div className="mini nx-auth">
      <main className="nx-main">
        <div className="nx-brand">
          <NexusMark size={44} />
          <b>nexus</b>
        </div>
        <div className="nx-heading">
          <h1>{title}</h1>
          {lead !== undefined && <p>{lead}</p>}
        </div>
        <div className="nx-card">{children}</div>
      </main>
    </div>
  );
}

export function Field(props: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  minLength?: number;
}) {
  const [shown, setShown] = useState(false);
  const isPassword = props.type === "password";
  const isEmail = props.type === "email";
  const input = (
    <input
      id={props.id}
      name={props.id}
      type={isPassword && shown ? "text" : props.type}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      autoComplete={props.autoComplete}
      {...(isEmail ? { inputMode: "email" as const, autoCapitalize: "none", spellCheck: false } : {})}
      {...(isPassword ? { autoCapitalize: "none", spellCheck: false } : {})}
      required
      className="mini-field"
    />
  );
  return (
    <div className="mini-label">
      <label htmlFor={props.id}>{props.label}</label>
      {isPassword ? (
        <div className="nx-pass">
          {input}
          <button
            type="button"
            className="nx-toggle"
            aria-label={`${shown ? "Ocultar" : "Mostrar"} ${props.id === "confirm" ? "confirmação" : "senha"}`}
            aria-pressed={shown}
            aria-controls={props.id}
            onClick={() => setShown((v) => !v)}
          >
            {shown ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      ) : (
        input
      )}
    </div>
  );
}

export function AuthForm(props: {
  onSubmit: () => void;
  error: string | null;
  submitting: boolean;
  submitLabel: string;
  submittingLabel: string;
  children: ReactNode;
}) {
  const errorId = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!props.submitting) props.onSubmit();
  };
  return (
    <form onSubmit={submit} noValidate className="nx-form" aria-describedby={props.error !== null ? errorId : undefined}>
      {props.children}
      {props.error !== null && (
        <p id={errorId} role="alert" className="nx-error">
          {props.error}
        </p>
      )}
      <button type="submit" disabled={props.submitting} className="mini-btn primary nx-submit">
        {props.submitting ? props.submittingLabel : props.submitLabel}
      </button>
    </form>
  );
}
