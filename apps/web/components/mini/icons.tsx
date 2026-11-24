import type { SVGProps } from "react";

/** Ícones desenhados para o Mini App: traço 2, pontas arredondadas, 24×24. */
function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

// Ícones exportados: aceitam as props de <svg> (tamanho, classe) por cima dos padrões de `Icon`.
export const CheckIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon width="18" height="18" {...props}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);
export const ChevronIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);
export const BackIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M15 6l-6 6 6 6" />
  </Icon>
);
export const MenuIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <circle cx="12" cy="5.5" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="18.5" r="1" />
  </Icon>
);
export const PlusIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const ClockIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon width="15" height="15" {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

/** N contínuo com o ponto terracota (identidade-visual.md). */
export function NexusMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 42 42" aria-hidden="true" focusable="false">
      <rect width="42" height="42" rx="13" fill="#142d3a" />
      <path
        d="M12 30V12C12 9 15 8 17 11L26 22C28 25 31 23 31 20V12"
        fill="none"
        stroke="#f5f6f2"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="35" cy="12" r="2.4" fill="#c05640" />
    </svg>
  );
}

export const TodayIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <rect x="4" y="5" width="16" height="15" rx="3.5" />
    <path d="M4 10h16M8.5 3.5v3M15.5 3.5v3" />
    <circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none" />
  </Icon>
);
export const HistoryIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M4 12a8 8 0 1 0 2.6-5.9L4 8.5" />
    <path d="M4 4v4.5h4.5M12 8v4.5l3 1.8" />
  </Icon>
);
export const UndoIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon width="18" height="18" {...props}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </Icon>
);

export const EyeIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </Icon>
);
export const EyeOffIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M4 4l16 16" />
    <path d="M9.9 6a9.6 9.6 0 0 1 2.1-.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.8 3.6M6.4 7.9A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 3.6-.7" />
    <path d="M10.2 10.2a2.8 2.8 0 0 0 3.6 3.6" />
  </Icon>
);

export const WalletIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <rect x="3.5" y="6" width="17" height="13" rx="3.5" />
    <path d="M3.5 10.5h17M15.5 15h2" />
  </Icon>
);

export const TrashIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon width="18" height="18" {...props}>
    <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5" />
  </Icon>
);

export const CloseIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
export const SettingsIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4L6 18M18 18l-1.6-1.6M7.6 7.6L6 6" />
  </Icon>
);
export const InviteIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="3.5" />
    <path d="M4.5 8l7.5 5.5L19.5 8" />
  </Icon>
);
