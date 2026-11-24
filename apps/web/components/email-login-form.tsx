"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthForm, Field } from "./auth-form";
import { useAuth } from "./auth-provider";

/** Entrada por e-mail e senha: o caminho de quem já definiu os dois, e o de reserva quando o Telegram não serve. */
export function EmailLoginForm({ onSignedIn }: { onSignedIn(): void }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submitLogin() {
    setError(null);
    setSubmitting(true);
    const result = await signIn(email.trim(), password);
    setSubmitting(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    onSignedIn();
  }

  return (
    <>
      <AuthForm
        onSubmit={() => void submitLogin()}
        error={error}
        submitting={submitting}
        submitLabel="Entrar"
        submittingLabel="Entrando…"
      >
        <Field id="email" label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          id="password"
          label="Senha"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
      </AuthForm>
      <p className="nx-links">
        <Link href="/recuperar" className="nx-link">
          Esqueci a senha
        </Link>
        {/* Sem "Criar conta": o acesso é por convite. /cadastro só redireciona para a entrada. */}
      </p>
    </>
  );
}
