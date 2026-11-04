"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthCard } from "@/components/auth-form";
import { useAuth } from "@/components/auth-provider";
import { EmailLoginForm } from "@/components/email-login-form";
import { QrLoginScreen } from "@/components/qr-login-screen";
import { useQrLogin } from "@/hooks/use-qr-login";
import { safeNext } from "@/lib/safe-next";

/** Aviso de quem chegou pelo endereço antigo de cadastro. */
function InviteNote() {
  const params = useSearchParams();
  if (params.get("acesso") !== "convite") return null;
  return (
    <p role="status" className="nx-note">
      O acesso ao Nexus é por convite.
    </p>
  );
}

/** Dentro do Telegram a entrada é automática; esta tela só serve de reserva, com e-mail e senha. */
function EmailOnly({ onSignedIn }: { onSignedIn(): void }) {
  return (
    <AuthCard title="Entrar" lead="Sua rotina, conectada.">
      <InviteNote />
      <EmailLoginForm onSignedIn={onSignedIn} />
    </AuthCard>
  );
}

function QrEntrar({ onSignedIn }: { onSignedIn(): void }) {
  const { exchangeToken, apiBaseUrl } = useAuth();
  const state = useQrLogin({ enabled: true, apiBaseUrl, exchangeToken, onSignedIn });
  return <QrLoginScreen state={state} emailForm={<EmailLoginForm onSignedIn={onSignedIn} />} note={<InviteNote />} />;
}

function EntrarContent() {
  const { telegram } = useAuth();
  // Só decide depois de montar: dentro do Telegram o initData só é lido num efeito do provedor, e criar um
  // pedido de QR antes disso seria desperdício (e gastaria o limite de pedidos do IP). Os dois estados
  // mudam na mesma passada de efeitos, então não há renderização intermediária.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const router = useRouter();
  const params = useSearchParams();
  const onSignedIn = () => router.replace(safeNext(params.get("next")));
  if (!mounted) return <div className="mini nx-auth" aria-hidden="true" />;
  return telegram.available ? <EmailOnly onSignedIn={onSignedIn} /> : <QrEntrar onSignedIn={onSignedIn} />;
}

export default function EntrarPage() {
  return (
    <Suspense fallback={null}>
      <EntrarContent />
    </Suspense>
  );
}
