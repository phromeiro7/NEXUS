"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { useAuth } from "@/components/auth-provider";
import { InviteIcon, NexusMark, SettingsIcon, TodayIcon, WalletIcon } from "@/components/mini/icons";
import { ToastProvider } from "@/components/mini/toast";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { ShortcutsProvider } from "./shortcuts";

type NavItem = { href: string; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> };

const MAIN_NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Hoje", Icon: TodayIcon },
  { href: "/financas", label: "Finanças", Icon: WalletIcon },
  { href: "/configuracoes", label: "Configurações", Icon: SettingsIcon },
];
const ADMIN_NAV_ITEMS: NavItem[] = [{ href: "/convites", label: "Convites", Icon: InviteIcon }];

/** "/" só casa exatamente; as demais seções também valem para as sub-rotas (ex.: /financas/x). */
const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

function NavItems({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <>
      {items.map(({ href, label, Icon }) => (
        <Link key={href} href={href} className="pn-link" title={label} aria-current={isActive(pathname, href) ? "page" : undefined}>
          <Icon />
          <span className="pn-lbl">{label}</span>
        </Link>
      ))}
    </>
  );
}

/**
 * Painel para computador: menu lateral fixo (vira só ícones em telas menores), conteúdo à direita e, no
 * rodapé do menu, os atalhos e quem está usando, com "Sair". "Convites" só aparece para administradores.
 */
export function PanelShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { displayName, signOut } = useAuth();
  const isAdmin = useIsAdmin();
  const shownName = displayName ?? "Você";

  return (
    <div className="mini pn">
      <ToastProvider>
        <ShortcutsProvider>
          <aside className="pn-side" aria-label="Menu do painel">
            <Link href="/" className="pn-brand" aria-label="Nexus, ir para Hoje">
              <NexusMark size={32} />
              <span className="pn-lbl">nexus</span>
            </Link>
            <nav className="pn-nav" aria-label="Seções">
              <NavItems items={MAIN_NAV_ITEMS} pathname={pathname} />
            </nav>
            {/* useIsAdmin é undefined enquanto carrega: só mostra com confirmação explícita. */}
            {isAdmin === true && (
              <>
                <div className="pn-sep" role="presentation" />
                <nav className="pn-nav" aria-label="Administração">
                  <NavItems items={ADMIN_NAV_ITEMS} pathname={pathname} />
                </nav>
              </>
            )}
            <div className="pn-side-foot">
              <div className="pn-keys" role="group" aria-label="Atalhos de teclado">
                <p className="pn-keys-title">Atalhos em Hoje e Finanças</p>
                <div>
                  <span>Nova tarefa</span>
                  <kbd className="pn-kbd">N</kbd>
                </div>
                <div>
                  <span>Anotar ou buscar</span>
                  <kbd className="pn-kbd">/</kbd>
                </div>
                <div>
                  <span>Ver atalhos</span>
                  <kbd className="pn-kbd">?</kbd>
                </div>
              </div>
              <div className="pn-user">
                <span className="pn-avatar" aria-hidden="true">
                  {shownName.charAt(0).toUpperCase()}
                </span>
                <span className="pn-user-name">{shownName}</span>
                <button type="button" className="pn-signout" onClick={() => void signOut()}>
                  Sair
                </button>
              </div>
            </div>
          </aside>
          <div className="pn-main">{children}</div>
        </ShortcutsProvider>
      </ToastProvider>
    </div>
  );
}
