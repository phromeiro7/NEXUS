"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthCard, AuthForm, Field } from "@/components/auth-form";
import { useAuth } from "@/components/auth-provider";

/** Pedido do link de recuperação de senha; a resposta é neutra para não revelar se a conta existe. */
export default function RecuperarPage() {
  const { sendReset } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submitResetRequest() {
    setError(null);
    setSent(false);
    setSubmitting(true);
    const result = await sendReset(email.trim());
    setSubmitting(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    setSent(true);
  }

  return (
    <AuthCard title="Recuperar senha" lead="Informe o e-mail da conta. Enviamos um link para criar uma nova senha.">
      <AuthForm
        onSubmit={() => void submitResetRequest()}
        error={error}
        submitting={submitting}
        submitLabel="Enviar link"
        submittingLabel="Enviando…"
      >
        <Field id="email" label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="email" />
      </AuthForm>
      {sent && (
        <p role="status" className="nx-ok">
          Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.
        </p>
      )}
      <p className="nx-links">
        <Link href="/entrar" className="nx-link">
          Voltar para entrar
        </Link>
      </p>
    </AuthCard>
  );
}
