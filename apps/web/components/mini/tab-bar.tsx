"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HistoryIcon, TodayIcon, WalletIcon } from "./icons";

const TABS = [
  { href: "/mini", label: "Hoje", Icon: TodayIcon },
  { href: "/mini/financas", label: "Finanças", Icon: WalletIcon },
  { href: "/mini/historico", label: "Histórico", Icon: HistoryIcon },
] as const;

/** Navegação principal ao alcance do polegar. Detalhe de tarefa e Configurações contam como "Hoje". */
export function TabBar() {
  const pathname = usePathname() ?? "/mini";
  // "Hoje" é a aba padrão: fica ativa em qualquer rota que não seja de outra aba nem Configurações.
  const onHistory = pathname.startsWith("/mini/historico");
  const onFinance = pathname.startsWith("/mini/financas");
  const onSettings = pathname.startsWith("/mini/configuracoes");
  return (
    <nav className="mini-tabs" aria-label="Principal">
      {TABS.map(({ href, label, Icon }) => {
        const isActive =
          href === "/mini/historico" ? onHistory : href === "/mini/financas" ? onFinance : !onHistory && !onFinance && !onSettings;
        return (
          <Link key={href} href={href} aria-current={isActive ? "page" : undefined} className="mini-tab">
            <Icon />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
