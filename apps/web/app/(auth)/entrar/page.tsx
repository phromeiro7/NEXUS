"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthCard, AuthForm, Field } from "@/components/auth-form";
import { useAuth } from "@/components/auth-provider";
import { safeNext } from "@/lib/safe-next";

function EntrarForm() {
  const { signIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    const result = await signIn(email.trim(), password);
    setSubmitting(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    router.replace(safeNext(params.get("next")));
  }

  return (
    <AuthCard title="Entrar" lead="Sua rotina, conectada.">
      <AuthForm
        onSubmit={() => void onSubmit()}
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
        {/* Sem "Criar conta" aqui: a conta virá do Telegram. /cadastro segue acessível por URL. */}
      </p>
    </AuthCard>
  );
}

export default function EntrarPage() {
  return (
    <Suspense fallback={null}>
      <EntrarForm />
    </Suspense>
  );
}
