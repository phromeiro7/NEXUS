"use client";

import type { FormEvent, ReactNode } from "react";
import { inputClass } from "./field";

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="rounded border border-[var(--color-borda)] bg-[var(--color-superficie)] p-4">
        {children}
      </div>
    </main>
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
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={props.id} className="text-sm font-medium">
        {props.label}
      </label>
      <input
        id={props.id}
        name={props.id}
        type={props.type}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        required
        className={inputClass}
      />
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
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!props.submitting) props.onSubmit();
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      {props.children}
      {props.error !== null && (
        <p role="alert" className="text-sm text-[var(--color-fatal)]">
          {props.error}
        </p>
      )}
      <button
        type="submit"
        disabled={props.submitting}
        className="rounded bg-[var(--color-destaque)] px-3 py-2 font-medium text-[var(--color-superficie)] disabled:opacity-60"
      >
        {props.submitting ? props.submittingLabel : props.submitLabel}
      </button>
    </form>
  );
}
