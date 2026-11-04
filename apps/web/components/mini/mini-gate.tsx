"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import type { TelegramLoginFailure } from "@/lib/telegram-login";
import { NexusMark } from "./icons";

/** O que dizer (e o que oferecer) para cada motivo de a entrada pelo Telegram não ter dado certo. */
function problemOf(error: TelegramLoginFailure | null): { title: string; text: string; retry: boolean } {
  switch (error) {
    case "telegram_nao_vinculado":
      return {
        title: "Este Telegram ainda não está ligado a uma conta",
        text: "Entre com seu e-mail uma vez e ligue o Telegram em Configurações. Depois o Nexus abre sozinho.",
        retry: false,
      };
    case "sessao_expirada":
    case "ja_utilizado":
      return {
        title: "Esse acesso já não vale",
        text: "Feche o Nexus e abra de novo pelo botão do bot. Se preferir, entre com e-mail.",
        retry: false,
      };
    case "rede":
      return { title: "Sem conexão", text: "Verifique sua internet e tente de novo.", retry: true };
    case "muitas_tentativas":
      return { title: "Muitas tentativas", text: "Aguarde um pouco e tente de novo.", retry: true };
    default:
      return { title: "Não foi possível entrar pelo Telegram", text: "Tente de novo ou entre com e-mail.", retry: true };
  }
}

function Screen({ children, busy }: { children: ReactNode; busy?: boolean }) {
  return (
    <div className="mini">
      <main className="mini-gate" {...(busy ? { role: "status", "aria-live": "polite" as const } : {})}>
        <NexusMark size={48} />
        {children}
      </main>
    </div>
  );
}

/**
 * Porta do Mini App. Dentro do Telegram a entrada é automática: enquanto ela acontece aparece "Entrando…"
 * (nunca o formulário de login); se falhar, ou se a pessoa saiu da conta, a tela explica e oferece o
 * caminho. Fora do Telegram, sem sessão, segue para /entrar como o resto do app.
 */
export function MiniGate({ children }: { children: ReactNode }) {
  const { status, redirectToLogin, configError, telegram } = useAuth();
  const held = telegram.available && (telegram.phase === "failed" || telegram.signedOut);

  useEffect(() => {
    if (status === "signedOut" && configError === null && !held) redirectToLogin();
  }, [status, configError, held, redirectToLogin]);

  if (configError !== null) {
    return (
      <Screen>
        <p role="alert">Configuração incompleta do aplicativo. {configError}</p>
      </Screen>
    );
  }
  if (status === "signedIn") return <>{children}</>;

  if (status === "signedOut" && held) {
    const email = "/entrar?next=%2Fmini";
    if (telegram.phase === "failed") {
      const p = problemOf(telegram.error);
      return (
        <Screen>
          <h1>{p.title}</h1>
          <p role="alert">{p.text}</p>
          <div className="mini-gate-actions">
            {p.retry ? (
              <button type="button" className="mini-btn primary" onClick={telegram.retry}>
                Tentar de novo
              </button>
            ) : null}
            <Link href={email} className={p.retry ? "mini-btn" : "mini-btn primary"}>
              Entrar com e-mail
            </Link>
          </div>
        </Screen>
      );
    }
    return (
      <Screen>
        <h1>Você saiu do Nexus</h1>
        <p>Para entrar de novo pelo Telegram, feche o Nexus e abra pelo botão do bot.</p>
        <div className="mini-gate-actions">
          <Link href={email} className="mini-btn primary">
            Entrar com e-mail
          </Link>
        </div>
      </Screen>
    );
  }

  return (
    <Screen busy>
      <p>{telegram.available ? "Entrando…" : "Carregando…"}</p>
    </Screen>
  );
}
