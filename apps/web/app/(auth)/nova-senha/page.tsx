"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthCard, AuthForm, Field } from "@/components/auth-form";
import { useAuth } from "@/components/auth-provider";

const MIN_PASSWORD = 8;

/**
 * Destino do link de recuperação. O supabase-js lê o token do fragmento da URL e cria a
 * sessão de recuperação (evento PASSWORD_RECOVERY); aqui só olhamos o estado da sessão.
 * O token nunca é lido, exibido nem registrado por este código.
 */
export default function NovaSenhaPage() {
  const { status, recovery, updatePassword } = useAuth();
  const [hashChecked, setHashChecked] = useState(false);
  const [hashError, setHashError] = useState(false);

  // Erro de link na URL (link expirado/usado): só a presença importa; o conteúdo nunca é
  // exibido nem registrado. Lido após a montagem para não divergir da renderização no servidor.
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    setHashError(params.has("error") || params.has("error_code") || params.has("error_description"));
    setHashChecked(true);
  }, []);
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

  // Espera a sessão inicial e a leitura do fragmento antes de decidir (sem piscar "inválido").
  if (status === "loading" || !hashChecked) {
    return (
      <AuthCard title="Nova senha">
        <p role="status">Verificando o link…</p>
      </AuthCard>
    );
  }

  if (!done && (hashError || status === "signedOut")) {
    return (
      <AuthCard title="Nova senha">
        <p role="alert" className="nx-error">
          O link de recuperação é inválido ou expirou. Peça um novo link.
        </p>
        <p className="nx-links">
          <Link href="/recuperar" className="nx-link">
            Pedir novo link
          </Link>
        </p>
      </AuthCard>
    );
  }

  // Sessão normal (sem o evento de recuperação): nunca oferece trocar a senha sem a atual.
  if (!done && !recovery) {
    return (
      <AuthCard title="Nova senha">
        <p className="nx-note">Este link só funciona a partir do e-mail de recuperação.</p>
        <p className="nx-links">
          <Link href="/configuracoes" className="nx-link">
            Configurações
          </Link>
          <Link href="/recuperar" className="nx-link">
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
        <p className="nx-note">Mínimo de {MIN_PASSWORD} caracteres.</p>
      </AuthForm>
      {done && (
        <p role="status" className="nx-ok">
          Senha atualizada. Levando você ao painel…
        </p>
      )}
    </AuthCard>
  );
}
