"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { NameForm, SettingsFields } from "@/components/mini/settings-screen";
import { TelegramCard } from "@/components/mini/telegram-card";
import { useSettings } from "@/hooks/queries";

/** Seção de configurações: título e dica à esquerda, conteúdo à direita. */
function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="pn-sec">
      <div>
        <h2>{title}</h2>
        <p className="pn-sub">{hint}</p>
      </div>
      <div className="pn-sec-body">{children}</div>
    </div>
  );
}

/**
 * Configurações do painel. Reaproveita os formulários do Mini App (nome, fuso, avisos e vínculo do Telegram),
 * cada um numa seção. Fora por enquanto: e-mail e senha opcionais e "sair de todos os aparelhos" (o cliente
 * de autenticação do app ainda não troca e-mail nem encerra as outras sessões).
 */
export function SettingsPanel() {
  const settingsQuery = useSettings();
  const { signOut } = useAuth();

  return (
    <div className="pn-body">
      <section aria-labelledby="pn-h-conf" style={{ maxWidth: 900 }}>
        <h1 id="pn-h-conf" className="pn-h1" style={{ marginBottom: 24 }}>
          Configurações
        </h1>

        <Section title="Como quer ser chamado" hint="Aparece na saudação do app.">
          <NameForm />
        </Section>

        <Section title="Horários e avisos" hint="Valem para todas as suas tarefas e contas.">
          {settingsQuery.isError ? (
            <p role="alert" className="mini-alert" style={{ marginTop: 0 }}>
              Não foi possível carregar as configurações. Tente de novo em instantes.
            </p>
          ) : settingsQuery.isPending ? (
            <div role="status" aria-label="Carregando configurações" className="mini-skeleton" style={{ height: 180 }} />
          ) : (
            // A key remonta o formulário quando os dados do servidor mudam, para os campos não ficarem com valores velhos.
            <SettingsFields key={JSON.stringify(settingsQuery.data)} settings={settingsQuery.data} />
          )}
        </Section>

        <Section title="Telegram" hint="Avisos e registro pelo chat.">
          {settingsQuery.data !== undefined ? (
            <TelegramCard linked={settingsQuery.data.telegramLinked} paused={settingsQuery.data.channelPaused} />
          ) : (
            <div role="status" aria-label="Carregando" className="mini-skeleton" />
          )}
        </Section>

        <Section title="Sessão" hint="Onde você está conectado.">
          <p style={{ margin: "0 0 12px" }}>
            <strong>Este computador</strong> <span className="pn-sub">· ativo agora</span>
          </p>
          <button type="button" className="mini-btn pn-small-btn" onClick={() => void signOut()}>
            Sair deste computador
          </button>
        </Section>
      </section>
    </div>
  );
}
