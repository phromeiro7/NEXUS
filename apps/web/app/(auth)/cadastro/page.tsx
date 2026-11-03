"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthCard, AuthForm, Field } from "@/components/auth-form";
import { useAuth } from "@/components/auth-provider";

const MIN_PASSWORD = 8;

export default function CadastroPage() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`A senha deve ter pelo menos ${MIN_PASSWORD} caracteres.`);
      return;
    }
    setSubmitting(true);
    const result = await signUp(email.trim(), password);
    setSubmitting(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    if (result.needsConfirmation) {
      setNotice("Enviamos um e-mail para confirmar o cadastro. Confirme e depois entre.");
      return;
    }
    router.replace("/");
  }

  return (
    <AuthCard title="Criar conta">
      <AuthForm
        onSubmit={() => void onSubmit()}
        error={error}
        submitting={submitting}
        submitLabel="Criar conta"
        submittingLabel="Criando…"
      >
        <Field id="email" label="E-mail" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          id="password"
          label="Senha"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        <p className="text-xs">Mínimo de {MIN_PASSWORD} caracteres.</p>
      </AuthForm>
      {notice !== null && (
        <p role="status" className="mt-3 text-sm text-[var(--color-sucesso)]">
          {notice}
        </p>
      )}
      <p className="mt-4 text-sm">
        <Link href="/entrar" className="underline">
          Já tenho conta
        </Link>
      </p>
    </AuthCard>
  );
}
