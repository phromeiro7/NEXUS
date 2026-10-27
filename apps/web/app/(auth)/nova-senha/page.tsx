"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AuthCard, AuthForm, Field } from "@/components/auth-form";
import { useAuth } from "@/components/auth-provider";

const MIN_PASSWORD = 8;

/**
 * Destino do link de recuperação. O supabase-js lê o token do fragmento da URL e cria a
 * sessão de recuperação (evento PASSWORD_RECOVERY); aqui só olhamos o estado da sessão.
 * O token nunca é lido, exibido nem registrado por este código.
 */
export default function NovaSenhaPage() {
  const { status, updatePassword } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const busy = useRef(false);

  async function onSubmit() {
    if (busy.current) return;
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`A senha deve ter pelo menos ${MIN_PASSWORD} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    busy.current = true;
    setSubmitting(true);
    const result = await updatePassword(password);
    busy.current = false;
    setSubmitting(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    setDone(true);
    router.replace("/");
  }

  if (status === "loading") {
    return (
      <AuthCard title="Nova senha">
        <p role="status">Verificando o link…</p>
      </AuthCard>
    );
  }

  if (status === "signedOut" && !done) {
    return (
      <AuthCard title="Nova senha">
        <p role="alert" className="text-sm text-[var(--color-fatal)]">
          O link de recuperação é inválido ou expirou. Peça um novo link.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/recuperar" className="inline-flex min-h-10 items-center underline">
            Pedir novo link
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Nova senha">
      <AuthForm
        onSubmit={() => void onSubmit()}
        error={error}
        submitting={submitting}
        submitLabel="Salvar nova senha"
        submittingLabel="Salvando…"
      >
        <Field
          id="password"
          label="Nova senha"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        <Field
          id="confirm"
          label="Confirmar senha"
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
        />
        <p className="text-xs">Mínimo de {MIN_PASSWORD} caracteres.</p>
      </AuthForm>
      {done && (
        <p role="status" className="mt-3 text-sm text-[var(--color-sucesso)]">
          Senha atualizada. Levando você ao painel…
        </p>
      )}
    </AuthCard>
  );
}
