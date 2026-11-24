"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import type { TelegramLoginFailure } from "@/lib/telegram-login";
import { NexusMark } from "./icons";

/** O que dizer (e o que oferecer) para cada motivo de a entrada pelo Telegram não ter dado certo. */
function describeLoginFailure(error: TelegramLoginFailure | null): { title: string; text: string; retry: boolean } {
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

const EMAIL_LOGIN_HREF = "/entrar?next=%2Fmini";

/** Moldura das telas da porta; `busy` anuncia o conteúdo como status para leitores de tela. */
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
  // Dentro do Telegram, depois de falha ou de sair da conta, a pessoa fica nesta tela em vez de ir para /entrar.
  const staysOnGate = telegram.available && (telegram.phase === "failed" || telegram.signedOut);

  // Sem sessão e sem motivo para segurar a pessoa aqui: segue para o login comum.
  useEffect(() => {
    if (status === "signedOut" && configError === null && !staysOnGate) redirectToLogin();
  }, [status, configError, staysOnGate, redirectToLogin]);

  if (configError !== null) {
    return (
      <Screen>
        <p role="alert">Configuração incompleta do aplicativo. {configError}</p>
      </Screen>
    );
  }
  if (status === "signedIn") return <>{children}</>;

  if (status === "signedOut" && staysOnGate) {
    if (telegram.phase === "failed") {
      const problem = describeLoginFailure(telegram.error);
      return (
        <Screen>
          <h1>{problem.title}</h1>
          <p role="alert">{problem.text}</p>
          <div className="mini-gate-actions">
            {problem.retry ? (
              <button type="button" className="mini-btn primary" onClick={telegram.retry}>
                Tentar de novo
              </button>
            ) : null}
            <Link href={EMAIL_LOGIN_HREF} className={problem.retry ? "mini-btn" : "mini-btn primary"}>
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
          <Link href={EMAIL_LOGIN_HREF} className="mini-btn primary">
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
